// CC045: cashier receipt photo with OR number, amount and date. AC1 upload/validation/view/delete, AC2 access (Executive 403,
// anonymous, out of scope, Office Staff/Head/Super Admin), AC3 audit and failure handling, AC4 no public URL, gone after delete.
// Only synthetic dummy images are used.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { DELETE as deleteRoute, GET as metaRoute, POST as uploadRoute } from '../src/app/api/transactions/[id]/receipt/route.js';
import { GET as imageRoute } from '../src/app/api/transactions/[id]/receipt/image/route.js';
import { GET as detailRoute } from '../src/app/api/transactions/[id]/route.js';
import { GET as cleanupRoute } from '../src/app/api/jobs/receipt-storage-cleanup/route.js';
import { RECEIPT_MAX_BYTES } from '../migrations/1794900200000-Cc045TransactionReceipts.js';
import { STALE_PENDING_MS, checkReceiptFile, normaliseAmount, runReceiptStorageCleanup, sniffImageType } from '../src/modules/receipts/receipts.js';
import { createMemoryStorage, setReceiptStorage, storageFromEnv } from '../src/modules/receipts/storage.js';
import { USERS, call, ctx, insertTransaction, req, resetData, setupTestEnv, tokens, OFFICE_A } from './helpers.js';

const JPEG = (size = 1024) => { const b = Buffer.alloc(size, 0x11); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
const PNG = (size = 1024) => { const b = Buffer.alloc(size, 0x22); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
const GIF = () => Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1');
const TEXT = () => Buffer.from('this is not an image, just text renamed to a photo');
const DETAILS = { or_number: '0001234', amount: '150', receipt_date: '2026-11-12' };

let env;
let storage;
let tx;
before(async () => {
  env = await setupTestEnv();
  process.env.CRON_SECRET = 'test-cron-secret-0123456789abcdef';
});
after(async () => {
  setReceiptStorage(null);
  await env?.teardown();
});
beforeEach(async () => {
  await resetData(env.ds);
  storage = createMemoryStorage();
  setReceiptStorage(storage);
  tx = await insertTransaction(env.ds, { started_by: USERS.staffA, tracking_no: `PUP-OSAS-20261112-${String(Math.floor(Math.random() * 8000) + 1000)}` });
});

function form(bytes, { name = 'receipt.jpg', type = 'image/jpeg', details = DETAILS } = {}) {
  const fd = new FormData();
  if (bytes !== null) fd.append('file', new File([bytes], name, type === null ? {} : { type }));
  for (const [k, v] of Object.entries(details)) fd.append(k, v);
  return fd;
}
const withToken = (token) => (token ? { authorization: `Bearer ${token}` } : {});
const upload = (fd, token = tokens.officeStaffA, id = tx.transaction_id) =>
  call(uploadRoute, new Request(`http://localhost/api/transactions/${id}/receipt`, { method: 'POST', headers: withToken(token), body: fd }), ctx(id));
const meta = (token = tokens.officeStaffA, id = tx.transaction_id) => call(metaRoute, req('GET', `/transactions/${id}/receipt`, { token }), ctx(id));
const remove = (token = tokens.officeStaffA, id = tx.transaction_id) => call(deleteRoute, req('DELETE', `/transactions/${id}/receipt`, { token }), ctx(id));
const image = async (token = tokens.officeStaffA, id = tx.transaction_id) => {
  const response = await imageRoute(req('GET', `/transactions/${id}/receipt/image`, { token }), ctx(id));
  return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
};
const audits = async () => (await env.ds.query("SELECT payload FROM audit_outbox WHERE payload->>'action' LIKE 'RECEIPT_%' ORDER BY created_at")).map((r) => r.payload);
const receiptRows = () => env.ds.query('SELECT * FROM transaction_receipts ORDER BY created_at');

describe('CC045 AC1: attach, view and delete', () => {
  it('a JPEG at exactly 2 MB attaches with OR number, amount and date; staff view and delete it', async () => {
    const bytes = JPEG(RECEIPT_MAX_BYTES);
    const r = await upload(form(bytes));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    const receipt = r.body.receipt;
    assert.deepEqual([receipt.or_number, receipt.amount, receipt.receipt_date, receipt.content_type, receipt.size_bytes], ['0001234', '150.00', '2026-11-12', 'image/jpeg', RECEIPT_MAX_BYTES]);
    assert.ok(!JSON.stringify(r.body).match(/receipts\/|http|storage|sha256/), 'no key, URL or hash in the answer');
    assert.equal(storage.objects.size, 1);
    assert.match([...storage.objects.keys()][0], new RegExp(`^receipts/${tx.transaction_id}/[0-9a-f-]{36}$`), 'a generated key, not the file name');

    assert.deepEqual((await meta()).body.receipt, receipt);
    const shown = await image();
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get('content-type'), 'image/jpeg');
    assert.equal(shown.headers.get('cache-control'), 'private, no-store');
    assert.equal(shown.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(shown.bytes.equals(bytes));

    const gone = await remove();
    assert.deepEqual([gone.status, gone.body], [200, { deleted: true, storage_purged: true }]);
    assert.equal(storage.objects.size, 0);
    assert.equal((await meta()).body.receipt, null);
    assert.equal((await image()).status, 404, 'access after deletion fails');
    assert.equal((await remove()).status, 404);
    const [row] = await receiptRows();
    assert.deepEqual([row.status, row.or_number, row.amount, row.receipt_date], ['DELETED', null, null, null], 'payment details cleared');

    // A PNG can be attached after the delete.
    const png = await upload(form(PNG(), { name: 'scan.PNG', type: 'image/png', details: { or_number: 'A-0099', amount: '1234.5', receipt_date: '2026-11-01' } }));
    assert.equal(png.status, 201, JSON.stringify(png.body));
    assert.deepEqual([png.body.receipt.content_type, png.body.receipt.amount, png.body.receipt.or_number], ['image/png', '1234.50', 'A-0099']);
    assert.equal((await upload(form(JPEG()))).body.error.code, 'RECEIPT_EXISTS', 'one receipt at a time');
  });

  it('refuses oversize files, invalid details, unsupported content and renamed non-images, before storage', async () => {
    const cases = [
      [form(JPEG(RECEIPT_MAX_BYTES + 1)), 413, 'RECEIPT_TOO_LARGE'],
      [form(Buffer.alloc(0)), 400, 'RECEIPT_EMPTY_FILE'],
      [form(null), 400, 'RECEIPT_EMPTY_FILE'],
      [form(GIF(), { name: 'receipt.gif', type: 'image/gif' }), 400, 'RECEIPT_UNSUPPORTED_TYPE'],
      [form(GIF(), { name: 'receipt.png', type: 'image/png' }), 400, 'RECEIPT_UNSUPPORTED_CONTENT'],
      [form(TEXT(), { name: 'receipt.jpg', type: 'image/jpeg' }), 400, 'RECEIPT_UNSUPPORTED_CONTENT'],
      [form(TEXT(), { name: 'receipt.jpg', type: null }), 400, 'RECEIPT_UNSUPPORTED_CONTENT'],
      [form(PNG(), { name: 'receipt.jpg', type: 'image/jpeg' }), 400, 'RECEIPT_TYPE_MISMATCH'],
      [form(JPEG(), { name: 'receipt.jpg', type: 'image/png' }), 400, 'RECEIPT_TYPE_MISMATCH'],
      [form(JPEG(), { name: 'receipt.pdf', type: 'application/pdf' }), 400, 'RECEIPT_UNSUPPORTED_TYPE'],
    ];
    for (const [fd, status, code] of cases) {
      const r = await upload(fd);
      assert.deepEqual([r.status, r.body.error.code], [status, code]);
    }
    const badDetails = [
      [{ ...DETAILS, or_number: '' }, 'or_number'], [{ ...DETAILS, or_number: '12 34' }, 'or_number'], [{ ...DETAILS, or_number: 'x'.repeat(31) }, 'or_number'],
      [{ ...DETAILS, amount: '0' }, 'amount'], [{ ...DETAILS, amount: '0.00' }, 'amount'], [{ ...DETAILS, amount: '-5' }, 'amount'], [{ ...DETAILS, amount: '1.234' }, 'amount'],
      [{ ...DETAILS, amount: '1e3' }, 'amount'], [{ ...DETAILS, amount: '' }, 'amount'], [{ ...DETAILS, amount: '12345678901' }, 'amount'],
      [{ ...DETAILS, receipt_date: '2026-02-30' }, 'receipt_date'], [{ ...DETAILS, receipt_date: '11/12/2026' }, 'receipt_date'], [{ ...DETAILS, receipt_date: '2999-01-01' }, 'receipt_date'],
    ];
    for (const [details, field] of badDetails) {
      const r = await upload(form(JPEG(), { details }));
      assert.equal(r.status, 400, JSON.stringify(details));
      assert.ok(r.body.error.details[field], `${field}: ${JSON.stringify(details)}`);
    }
    assert.equal(storage.objects.size, 0);
    assert.equal((await receiptRows()).length, 0);
    assert.equal((await audits()).length, 0);
  });

  it('pure helpers: signatures, fixed-precision amounts', () => {
    assert.equal(sniffImageType(JPEG(4)), 'image/jpeg');
    assert.equal(sniffImageType(PNG(8)), 'image/png');
    assert.equal(sniffImageType(Buffer.from([0xff, 0xd8])), null);
    assert.equal(sniffImageType(GIF()), null);
    assert.deepEqual(['007', '7.5', '0.01', '9999999999.99', '00150.10'].map(normaliseAmount), ['7.00', '7.50', '0.01', '9999999999.99', '150.10']);
    assert.equal(checkReceiptFile({ bytes: JPEG(), fileName: 'a.jpeg', declaredType: 'image/jpeg; charset=binary' }), 'image/jpeg');
    assert.equal(checkReceiptFile({ bytes: PNG(), fileName: 'A.Png', declaredType: '' }), 'image/png');
  });
});

describe('CC045 access follows the transaction (RBAC: "View the transaction list (and its receipt)")', () => {
  // Office Staff: own records only; Office Head: own office; Super Admin: all. A same-office colleague who did not start the
  // transaction is refused on the transaction AND on every receipt route, so the API never reaches beyond the transaction view.
  it('a same-office colleague gets 403 on the transaction and on every receipt route; nothing changes', async () => {
    assert.equal((await upload(form(JPEG()))).status, 201); // staff A started tx and attached the receipt
    const detail = await call(detailRoute, req('GET', `/transactions/${tx.transaction_id}`, { token: tokens.officeStaffA2 }), ctx(tx.transaction_id));
    assert.equal(detail.status, 403, 'transaction detail: own records only');
    assert.equal((await meta(tokens.officeStaffA2)).status, 403, 'receipt details');
    assert.equal((await image(tokens.officeStaffA2)).status, 403, 'receipt photo');
    assert.equal((await remove(tokens.officeStaffA2)).status, 403, 'delete');
    assert.equal((await upload(form(JPEG()), tokens.officeStaffA2)).status, 403, 'upload');
    assert.equal(storage.objects.size, 1);
    assert.deepEqual((await audits()).map((a) => a.action), ['RECEIPT_UPLOADED'], 'refused requests are not audited as views');
  });

  it('the Office Head of the office reaches every receipt of the office; the starter reaches their own', async () => {
    assert.equal((await upload(form(JPEG()), tokens.officeHeadA)).status, 201, 'Office Head: own office, not only their own records');
    assert.equal((await image(tokens.officeStaffA)).status, 200, 'the staff member who started it');
    assert.equal((await remove(tokens.officeStaffA)).status, 200);
  });
});

describe('CC045 AC2: who may see receipts', () => {
  it('Executive gets 403 on every receipt route even though it can read the transaction, which carries no receipt data', async () => {
    assert.equal((await upload(form(JPEG()))).status, 201);
    const detail = await call(detailRoute, req('GET', `/transactions/${tx.transaction_id}`, { token: tokens.executive }), ctx(tx.transaction_id));
    assert.equal(detail.status, 200);
    assert.ok(!/receipt_|or_number|attachment/.test(JSON.stringify(detail.body).replace('receipt_email', '')), JSON.stringify(detail.body));
    assert.equal((await meta(tokens.executive)).status, 403);
    assert.equal((await image(tokens.executive)).status, 403);
    assert.equal((await upload(form(JPEG()), tokens.executive)).status, 403);
    assert.equal((await remove(tokens.executive)).status, 403);
    assert.equal(storage.objects.size, 1, 'nothing changed');
    assert.equal((await audits()).filter((a) => a.action === 'RECEIPT_VIEWED').length, 0, 'a refused view is not served or recorded');
  });

  it('anonymous is 401; another office or another staff member is 403; the starter, Office Head and Super Admin are allowed', async () => {
    assert.equal((await upload(form(JPEG()), null)).status, 401);
    assert.equal((await upload(form(JPEG()))).status, 201);
    assert.equal((await meta(null)).status, 401);
    assert.equal((await image(null)).status, 401);
    assert.equal((await remove(null)).status, 401);
    // Another office, and Office Staff A2 (same office, did not start it: own records only).
    for (const token of [tokens.officeStaffB, tokens.officeHeadB, tokens.officeStaffA2]) {
      assert.equal((await meta(token)).status, 403);
      assert.equal((await image(token)).status, 403);
      assert.equal((await remove(token)).status, 403);
    }
    for (const token of [tokens.officeStaffA, tokens.officeHeadA, tokens.superAdmin]) {
      assert.equal((await meta(token)).status, 200);
      assert.equal((await image(token)).status, 200);
    }
    assert.equal((await remove(tokens.officeHeadA)).status, 200);
    assert.equal((await upload(form(PNG(), { name: 'r.png', type: 'image/png' }), tokens.superAdmin)).status, 201);
    assert.equal((await remove(tokens.superAdmin)).status, 200);
    assert.equal((await meta(tokens.superAdmin, '00000000-0000-4000-8000-000000000000')).status, 404);
  });
});

describe('CC045 AC3: audit and failures', () => {
  it('upload, view and delete are audited without the image, key or payment details', async () => {
    const bytes = JPEG(4096);
    await upload(form(bytes));
    await image();
    await remove(tokens.officeHeadA);
    const events = await audits();
    assert.deepEqual(events.map((e) => e.action), ['RECEIPT_UPLOADED', 'RECEIPT_VIEWED', 'RECEIPT_DELETED']);
    assert.deepEqual(events.map((e) => e.actor_user_id), [USERS.staffA, USERS.staffA, USERS.headA]);
    const [row] = await receiptRows();
    for (const e of events) {
      assert.equal(e.entity_id, tx.transaction_id);
      assert.equal(e.office_id, OFFICE_A);
      assert.ok(e.occurred_at);
      assert.equal(e.after_value.attachment_id, row.attachment_id);
      const text = JSON.stringify(e);
      for (const secret of ['0001234', '150', '2026-11-12', row.storage_key, bytes.toString('base64').slice(0, 40), row.sha256]) assert.ok(!text.includes(secret), `${e.action} leaks ${secret}`);
    }
  });

  it('a storage failure on upload reports 503, leaves nothing readable, and a retry succeeds', async () => {
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
      storage.put = async () => { throw new Error('provider down'); };
      const failed = await upload(form(JPEG()));
      assert.deepEqual([failed.status, failed.body.error.code], [503, 'RECEIPT_STORAGE_UNAVAILABLE']);
      assert.equal((await meta()).body.receipt, null);
      assert.equal((await audits()).length, 0, 'no audit for an upload that did not complete');
    } finally {
      console.error = original;
    }
    setReceiptStorage((storage = createMemoryStorage()));
    const retried = await upload(form(JPEG()));
    assert.equal(retried.status, 201, JSON.stringify(retried.body));
    assert.ok(logged.length && logged.every((line) => !line.includes('0001234') && !line.includes('receipts/')), logged.join('\n'));
  });

  it('a failure after the object is stored deletes it again and reports that nothing was saved', async () => {
    const realPut = storage.put;
    storage.put = async (key, bytes, type) => {
      await realPut(key, bytes, type);
      await env.ds.query("UPDATE transaction_receipts SET status = 'DELETED', deleted_at = now(), or_number = NULL, amount = NULL, receipt_date = NULL WHERE storage_key = $1", [key]);
    };
    const original = console.error;
    console.error = () => {};
    try {
      const r = await upload(form(JPEG()));
      assert.deepEqual([r.status, r.body.error.code], [503, 'RECEIPT_NOT_SAVED']);
    } finally {
      console.error = original;
    }
    assert.equal(storage.objects.size, 0, 'the orphan was removed');
    assert.equal((await audits()).length, 0);
    assert.equal((await image()).status, 404);
  });

  it('the view is recorded before the bytes are read; a storage read failure serves nothing', async () => {
    await upload(form(JPEG()));
    storage.get = async () => { throw new Error('read failed'); };
    const original = console.error;
    console.error = () => {};
    try {
      const r = await image();
      assert.equal(r.status, 503);
      assert.ok(!r.bytes.includes(Buffer.from([0xff, 0xd8, 0xff])));
    } finally {
      console.error = original;
    }
    assert.deepEqual((await audits()).map((e) => e.action), ['RECEIPT_UPLOADED', 'RECEIPT_VIEWED']);
  });

  it('a storage failure on delete still deletes (never readable again); the cleanup job purges the object later', async () => {
    await upload(form(JPEG()));
    const realDelete = storage.delete;
    storage.delete = async () => { throw new Error('provider down'); };
    const original = console.error;
    console.error = () => {};
    let r;
    try {
      r = await remove();
    } finally {
      console.error = original;
    }
    assert.deepEqual([r.status, r.body], [200, { deleted: true, storage_purged: false }]);
    assert.equal((await image()).status, 404);
    assert.equal(storage.objects.size, 1, 'the object is still there, unreachable');
    storage.delete = realDelete;
    const unauthorised = await cleanupRoute(new Request('http://localhost/api/jobs/receipt-storage-cleanup'));
    assert.equal(unauthorised.status, 401);
    const job = await call(cleanupRoute, new Request('http://localhost/api/jobs/receipt-storage-cleanup', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    assert.equal(job.status, 200, JSON.stringify(job.body));
    assert.equal(job.body.purged, 1);
    assert.equal(storage.objects.size, 0);
    assert.notEqual((await receiptRows())[0].storage_purged_at, null);
    assert.equal((await runReceiptStorageCleanup(env.ds, { storage })).purged, 0, 'idempotent');
  });

  it('an interrupted upload (stale PENDING) does not block a new one and its object is purged', async () => {
    await upload(form(JPEG()));
    await env.ds.query(`UPDATE transaction_receipts SET status = 'PENDING', confirmed_at = NULL, created_at = now() - make_interval(secs => $1)`, [STALE_PENDING_MS / 1000 + 5]);
    assert.equal((await image()).status, 404, 'a PENDING row is never served');
    assert.equal((await runReceiptStorageCleanup(env.ds, { storage })).purged, 1);
    assert.equal(storage.objects.size, 0);
    assert.equal((await upload(form(JPEG()))).status, 201);
    // A fresh PENDING row blocks a parallel upload instead of racing it.
    await env.ds.query("UPDATE transaction_receipts SET status = 'PENDING', confirmed_at = NULL, created_at = now() WHERE status = 'ACTIVE'");
    assert.equal((await upload(form(JPEG()))).body.error.code, 'RECEIPT_UPLOAD_IN_PROGRESS');
  });
});

describe('CC045 AC4: private storage only', () => {
  it('no URL, key or receipt data in transaction, list or analytics payloads; storage refuses demo adapters on hosted', async () => {
    await upload(form(JPEG()));
    const detail = await call(detailRoute, req('GET', `/transactions/${tx.transaction_id}`, { token: tokens.officeStaffA }), ctx(tx.transaction_id));
    const [row] = await receiptRows();
    for (const text of [JSON.stringify(detail.body), JSON.stringify(await env.ds.query('SELECT payload FROM analytics_outbox'))]) {
      assert.ok(!text.includes(row.storage_key) && !text.includes('0001234') && !text.includes('attachment_id'));
    }
    assert.equal(storageFromEnv({ RECEIPT_STORAGE: 'memory', VERCEL: '1' }).kind, 'none');
    assert.equal(storageFromEnv({ RECEIPT_STORAGE: 'filesystem', RECEIPT_STORAGE_DIR: '/tmp/x', VERCEL: '1' }).kind, 'none');
    assert.equal(storageFromEnv({ RECEIPT_STORAGE: 'vercel-blob' }).kind, 'none');
    assert.equal(storageFromEnv({}).kind, 'none');
    assert.equal(storageFromEnv({ RECEIPT_STORAGE: 'memory' }).kind, 'memory');
  });

  it('without configured storage an upload is 503 and nothing is reserved', async () => {
    setReceiptStorage(storageFromEnv({}));
    const r = await upload(form(JPEG()));
    assert.deepEqual([r.status, r.body.error.code], [503, 'RECEIPT_STORAGE_UNAVAILABLE']);
    assert.equal((await receiptRows()).length, 0);
  });
});
