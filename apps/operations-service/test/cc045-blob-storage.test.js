// CC045 private Vercel Blob adapter, against an in-memory double of the @vercel/blob SDK (no network, no hosted quota):
// the SDK calls and options, failures, no Blob URL or credential reaching a response or the audit, and the receipt permissions
// with the adapter in place. Dummy images only.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { DELETE as deleteRoute, GET as metaRoute, POST as uploadRoute } from '../src/app/api/transactions/[id]/receipt/route.js';
import { GET as imageRoute } from '../src/app/api/transactions/[id]/receipt/image/route.js';
import { GET as cleanupRoute } from '../src/app/api/jobs/receipt-storage-cleanup/route.js';
import { RECEIPT_MAX_BYTES } from '../migrations/1794900200000-Cc045TransactionReceipts.js';
import { StorageUnavailableError, blobStoreConnected, createVercelBlobStorage, setReceiptStorage, storageFromEnv } from '../src/modules/receipts/storage.js';
import { USERS, call, ctx, insertTransaction, req, resetData, setupTestEnv, tokens } from './helpers.js';

const STORE_HOST = 'https://abc123storeid.private.blob.vercel-storage.com';
const JPEG = (size = 2048) => { const b = Buffer.alloc(size, 0x33); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
const streamOf = (bytes, chunk = 4096) => new ReadableStream({
  start(controller) {
    for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(new Uint8Array(bytes.subarray(i, i + chunk)));
    controller.close();
  },
});

/** A double of put/get/del with the SDK's private-store behaviour: exact pathnames, no overwrite, null on a missing blob. */
function fakeBlobSdk() {
  const objects = new Map();
  const calls = [];
  const fail = {};
  const sdk = {
    objects, calls, fail,
    async put(pathname, body, options) {
      calls.push(['put', pathname, options]);
      if (fail.put) throw Object.assign(new Error(`${STORE_HOST}/${pathname} BLOB_READ_WRITE_TOKEN=vercel_blob_rw_secret`), { name: fail.put });
      if (objects.has(pathname) && !options.allowOverwrite) throw Object.assign(new Error('exists'), { name: 'BlobError' });
      objects.set(pathname, { bytes: Buffer.from(body), contentType: options.contentType, access: options.access });
      return { url: `${STORE_HOST}/${pathname}`, downloadUrl: `${STORE_HOST}/${pathname}?download=1`, pathname, contentType: options.contentType };
    },
    async get(pathname, options) {
      calls.push(['get', pathname, options]);
      if (fail.get) throw Object.assign(new Error(`${STORE_HOST}/${pathname}`), { name: fail.get });
      const found = objects.get(pathname);
      if (!found) return null;
      return { statusCode: 200, stream: streamOf(found.bytes), headers: new Headers(), blob: { url: `${STORE_HOST}/${pathname}`, pathname, contentType: found.contentType, size: found.bytes.length } };
    },
    async del(pathname) {
      calls.push(['del', pathname]);
      if (fail.del) throw Object.assign(new Error(`${STORE_HOST}/${pathname}`), { name: fail.del });
      objects.delete(pathname);
    },
  };
  return sdk;
}

describe('the private Blob adapter itself', () => {
  it('puts with private access, the exact key, the content type and no overwrite; discards the returned URL', async () => {
    const sdk = fakeBlobSdk();
    const store = createVercelBlobStorage({ sdk });
    assert.equal(store.kind, 'vercel-blob');
    assert.equal(await store.put('receipts/t/a', JPEG(), 'image/jpeg'), undefined, 'nothing (no URL) comes back');
    assert.deepEqual(sdk.calls[0], ['put', 'receipts/t/a', { access: 'private', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: false }]);
    assert.equal(sdk.objects.get('receipts/t/a').access, 'private');
    const bytes = await store.get('receipts/t/a');
    assert.ok(bytes.equals(JPEG()));
    assert.deepEqual(sdk.calls[1], ['get', 'receipts/t/a', { access: 'private' }]);
    await store.delete('receipts/t/a');
    assert.equal(await store.get('receipts/t/a'), null, 'a missing blob reads as null');
    await store.delete('receipts/t/a'); // deleting a missing object is not an error
  });

  it('turns every SDK failure into StorageUnavailableError carrying only the error name (no URL, no token)', async () => {
    const sdk = fakeBlobSdk();
    const store = createVercelBlobStorage({ sdk });
    for (const op of ['put', 'get', 'del']) {
      sdk.fail[op] = 'BlobServiceNotAvailable';
      const err = await (op === 'put' ? store.put('k', JPEG(), 'image/jpeg') : op === 'get' ? store.get('k') : store.delete('k')).catch((e) => e);
      assert.ok(err instanceof StorageUnavailableError, op);
      assert.equal(err.message, 'Private Blob BlobServiceNotAvailable');
      assert.ok(!/vercel-storage|vercel_blob_rw|http/.test(err.message));
      delete sdk.fail[op];
    }
    sdk.fail.del = 'BlobNotFoundError';
    await store.delete('gone'); // already gone: fine
  });

  it('refuses a stored object larger than a receipt can be, and a non-200 read', async () => {
    const big = createVercelBlobStorage({ sdk: { get: async () => ({ statusCode: 200, stream: streamOf(Buffer.alloc(RECEIPT_MAX_BYTES + 1)) }) } });
    await assert.rejects(big.get('k'), StorageUnavailableError);
    const notModified = createVercelBlobStorage({ sdk: { get: async () => ({ statusCode: 304, stream: null }) } });
    await assert.rejects(notModified.get('k'), StorageUnavailableError);
  });

  it('is selected by RECEIPT_STORAGE=vercel-blob only when a store is connected; otherwise a clear 503 storage', () => {
    assert.equal(storageFromEnv({ RECEIPT_STORAGE: 'vercel-blob', VERCEL: '1' }).kind, 'none');
    assert.match(storageFromEnv({ RECEIPT_STORAGE: 'vercel-blob' }).reason, /no Blob store is connected/);
    assert.equal(storageFromEnv({ RECEIPT_STORAGE: 'vercel-blob', VERCEL: '1', BLOB_STORE_ID: 'store_abc' }).kind, 'vercel-blob');
    assert.equal(storageFromEnv({ RECEIPT_STORAGE: 'vercel-blob', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x' }).kind, 'vercel-blob');
    assert.equal(blobStoreConnected({ BLOB_STORE_ID: '  ' }), false);
    // The local adapters are kept for tests and development, and stay refused on a hosted deployment.
    assert.equal(storageFromEnv({ RECEIPT_STORAGE: 'memory' }).kind, 'memory');
    assert.equal(storageFromEnv({ RECEIPT_STORAGE: 'memory', VERCEL: '1' }).kind, 'none');
  });
});

describe('receipts through the routes with the private Blob adapter', () => {
  let env;
  let sdk;
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
    sdk = fakeBlobSdk();
    setReceiptStorage(createVercelBlobStorage({ sdk }));
    tx = await insertTransaction(env.ds, { started_by: USERS.staffA, tracking_no: `PUP-OSAS-20261113-${String(1000 + Math.floor(Math.random() * 8000))}` });
  });

  const form = () => {
    const fd = new FormData();
    fd.append('file', new File([JPEG()], 'dummy-receipt.jpg', { type: 'image/jpeg' }));
    fd.append('or_number', '0000777');
    fd.append('amount', '25');
    fd.append('receipt_date', '2026-11-12');
    return fd;
  };
  const auth = (token) => (token ? { authorization: `Bearer ${token}` } : {});
  const upload = (token = tokens.officeStaffA) => call(uploadRoute, new Request(`http://localhost/api/transactions/${tx.transaction_id}/receipt`, { method: 'POST', headers: auth(token), body: form() }), ctx(tx.transaction_id));
  const meta = (token) => call(metaRoute, req('GET', `/transactions/${tx.transaction_id}/receipt`, { token }), ctx(tx.transaction_id));
  const remove = (token) => call(deleteRoute, req('DELETE', `/transactions/${tx.transaction_id}/receipt`, { token }), ctx(tx.transaction_id));
  const image = async (token) => {
    const r = await imageRoute(req('GET', `/transactions/${tx.transaction_id}/receipt/image`, { token }), ctx(tx.transaction_id));
    return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) };
  };
  const quiet = async (fn) => {
    const original = console.error;
    const lines = [];
    console.error = (...a) => lines.push(a.join(' '));
    try { return { result: await fn(), lines }; } finally { console.error = original; }
  };

  it('upload, view and delete store bytes in Blob and details in the database, with no Blob URL anywhere in a response', async () => {
    const up = await upload();
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(sdk.objects.size, 1);
    const [key] = sdk.objects.keys();
    const [row] = await env.ds.query('SELECT storage_key, or_number, amount::text FROM transaction_receipts');
    assert.deepEqual([row.storage_key, row.or_number, row.amount], [key, '0000777', '25.00']);

    const shown = await image(tokens.officeHeadA);
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get('cache-control'), 'private, no-store');
    assert.equal(shown.headers.get('content-type'), 'image/jpeg');
    assert.ok(shown.bytes.equals(JPEG()));

    const everything = JSON.stringify([up.body, (await meta(tokens.officeStaffA)).body, [...shown.headers]]);
    for (const leak of ['vercel-storage', 'blob.vercel', key, 'vercel_blob_rw', 'downloadUrl']) assert.ok(!everything.includes(leak), leak);

    assert.deepEqual((await remove(tokens.superAdmin)).body, { deleted: true, storage_purged: true });
    assert.equal(sdk.objects.size, 0);
    assert.equal((await image(tokens.officeStaffA)).status, 404);
    const audits = await env.ds.query("SELECT payload FROM audit_outbox WHERE payload->>'action' LIKE 'RECEIPT_%' ORDER BY created_at");
    assert.deepEqual(audits.map((a) => a.payload.action), ['RECEIPT_UPLOADED', 'RECEIPT_VIEWED', 'RECEIPT_DELETED']);
    assert.ok(!JSON.stringify(audits).includes('vercel-storage') && !JSON.stringify(audits).includes(key));
  });

  it('permissions are unchanged: anonymous 401, Executive and another office 403, nothing touches Blob', async () => {
    assert.equal((await upload()).status, 201);
    const before = sdk.calls.length;
    assert.equal((await upload(null)).status, 401);
    assert.equal((await image(null)).status, 401);
    for (const token of [tokens.executive, tokens.officeStaffB, tokens.officeHeadB, tokens.officeStaffA2]) {
      assert.equal((await image(token)).status, 403);
      assert.equal((await meta(token)).status, 403);
      assert.equal((await remove(token)).status, 403);
      assert.equal((await upload(token)).status, 403);
    }
    assert.equal(sdk.calls.length, before, 'refused requests never reach the Blob store');
  });

  it('Blob outages: a failed put is 503 with nothing left; a failed get is 503 after the audited view; a failed delete is purged by the daily cleanup', async () => {
    sdk.fail.put = 'BlobServiceNotAvailable';
    const { result: failedUpload, lines } = await quiet(() => upload());
    assert.deepEqual([failedUpload.status, failedUpload.body.error.code], [503, 'RECEIPT_STORAGE_UNAVAILABLE']);
    assert.ok(lines.every((l) => !l.includes('vercel-storage') && !l.includes('vercel_blob_rw')), lines.join('\n'));
    delete sdk.fail.put;
    assert.equal((await upload()).status, 201, 'a retry succeeds');

    sdk.fail.get = 'BlobServiceRateLimited';
    const { result: failedView } = await quiet(() => image(tokens.officeStaffA));
    assert.equal(failedView.status, 503);
    assert.ok(!failedView.bytes.includes(Buffer.from([0xff, 0xd8, 0xff])));
    delete sdk.fail.get;

    sdk.fail.del = 'BlobServiceNotAvailable';
    const { result: deleted } = await quiet(() => remove(tokens.officeStaffA));
    assert.deepEqual(deleted.body, { deleted: true, storage_purged: false });
    assert.equal(sdk.objects.size, 1, 'still in Blob, but never served again');
    assert.equal((await image(tokens.officeStaffA)).status, 404);
    delete sdk.fail.del;
    const job = await call(cleanupRoute, new Request('http://localhost/api/jobs/receipt-storage-cleanup', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    // Two rows were not purged: the deleted receipt, and the failed upload (its object state was unknown, so it is deleted too).
    assert.equal(job.body.purged, 2);
    assert.equal(sdk.objects.size, 0);
  });
});
