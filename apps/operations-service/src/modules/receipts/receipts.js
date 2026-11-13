import { createHash, randomUUID } from 'node:crypto';
import { AppError, Errors, ROLES, isUuid, isValidManilaDate, recordAudit, toManilaDate } from 'ccms-shared';
import { kickOutbox } from '../../lib/outbox.js';
import { canAccessTransaction } from '../transaction/access.js';
import { RECEIPT_MAX_BYTES } from '../../../migrations/1794900200000-Cc045TransactionReceipts.js';
import { StorageUnavailableError } from './storage.js';

// =================================================================================================================
// CC045 proof of payment: a cashier receipt photo with its official receipt (OR) number, amount and receipt date.
//
// Who        The receipt is part of the transaction, so it follows the transaction rule (access.js canAccessTransaction, the
//            RBAC table "View the transaction list (and its receipt)"): Super Admin all, Office Head their own office, Office
//            Staff only their own records (the transactions they started). The same scope reads, uploads and deletes, as it
//            already does for Start and Complete. Executive gets 403 on every receipt route, even though it may read the
//            transaction (K14 view): the Executive read rule (canReadTransaction) is deliberately NOT used here.
// File       JPEG (.jpg / .jpeg) or PNG, 1 byte to 2 MiB (2,097,152 bytes) inclusive. The actual bytes must start with the
//            JPEG (FF D8 FF) or PNG (89 50 4E 47 0D 0A 1A 0A) signature AND agree with the file's extension and declared
//            type; anything else is refused before storage is touched.
// Details    or_number   1-30 letters, digits or dashes, starting with a letter or digit; kept as typed (leading zeros stay)
//            amount      a decimal string with at most 2 decimals, more than 0, at most 9,999,999,999.99 (numeric(12,2))
//            receipt_date YYYY-MM-DD, a real date, not after today in Manila
// Storage    private, behind the adapter in storage.js. The key is generated (receipts/<transaction>/<uuid>) and never leaves
//            Operations: no URL, key or byte goes into a JSON answer, an audit entry, analytics or reports.
// Audit      RECEIPT_UPLOADED, RECEIPT_VIEWED, RECEIPT_DELETED through the shared audit outbox (entity: the transaction, by
//            tracking number). Each carries only ids, the content type and size - never the image, the storage key, the OR
//            number, the amount or the date. A view is recorded (committed) BEFORE the bytes are read and served.
//
// Failure handling (no orphan is ever served, and success is reported only for what completed):
//   upload   1. reserve a PENDING row (refused when an ACTIVE or a fresh PENDING one exists)  2. put the object
//            3. confirm ACTIVE + audit in one database transaction. A storage failure marks the row DELETED (503); a failure
//            at 3 deletes the object again and marks the row DELETED (503). Only an ACTIVE row is ever read.
//   delete   the row becomes DELETED (payment details cleared) with its audit in one database transaction, then the object is
//            deleted. If storage fails then, the answer still says deleted (it can never be read again) and storage_purged_at
//            stays empty for the cleanup job.
//   cleanup  runReceiptStorageCleanup: deletes the objects of DELETED rows not yet purged and of PENDING rows older than
//            15 minutes (an interrupted upload), and marks them. Safe to run any time; idempotent.
// =================================================================================================================

export const RECEIPT_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);
export const STALE_PENDING_MS = 15 * 60 * 1000;
const MAX_REQUEST_BYTES = RECEIPT_MAX_BYTES + 16 * 1024;
const OR_NUMBER = /^[A-Za-z0-9][A-Za-z0-9-]{0,29}$/;
const AMOUNT = /^(\d{1,10})(?:\.(\d{1,2}))?$/;
const TYPES = Object.freeze({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' });
const EXTENSION_FOR = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png' });
const STORAGE_DOWN = 'Receipt photos cannot be stored or shown right now. Please try again later.';

const fileError = (code, message) => new AppError(400, code, message, { file: message });
const tooLarge = () => new AppError(413, 'RECEIPT_TOO_LARGE', 'The photo must be 2 MB or smaller.', { file: 'The photo must be 2 MB or smaller.' });
const storageDown = () => Errors.unavailable(STORAGE_DOWN, 'RECEIPT_STORAGE_UNAVAILABLE');
const notFound = () => Errors.notFound('No receipt is attached to this transaction', 'RECEIPT_NOT_FOUND');

/** Receipt access = the operator rule for the transaction itself (Executive and any other role: false). */
export function canAccessReceipts(user, transaction) {
  return Boolean(user) && canAccessTransaction(user, transaction);
}

async function loadScopedTransaction(manager, user, transactionId) {
  if (!isUuid(transactionId)) throw Errors.notFound('Transaction not found', 'TRANSACTION_NOT_FOUND');
  const [row] = await manager.query('SELECT transaction_id, tracking_no, office_id, started_by FROM transactions WHERE transaction_id = $1', [transactionId]);
  if (!row) throw Errors.notFound('Transaction not found', 'TRANSACTION_NOT_FOUND');
  if (!canAccessReceipts(user, row)) throw Errors.forbidden();
  return row;
}

/** Which image the bytes actually are, by signature only. */
export function sniffImageType(bytes) {
  const b = Buffer.from(bytes ?? []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

/**
 * The content type of an upload: the extension and the declared type (when the browser sent one) must name the same allowed
 * type, and the bytes must carry that type's signature. Throws 400/413 otherwise.
 */
export function checkReceiptFile({ bytes, fileName, declaredType }) {
  if (!bytes || bytes.length === 0) throw fileError('RECEIPT_EMPTY_FILE', 'Choose a photo of the receipt. The file is empty.');
  if (bytes.length > RECEIPT_MAX_BYTES) throw tooLarge();
  const extension = /\.([A-Za-z0-9]+)$/.exec(String(fileName ?? ''))?.[1]?.toLowerCase();
  const byName = TYPES[extension];
  if (!byName) throw fileError('RECEIPT_UNSUPPORTED_TYPE', 'Use a JPG or PNG photo.');
  // A generic binary type is "not declared" (some clients send it for every file); the signature check below still applies.
  const raw = String(declaredType ?? '').split(';')[0].trim().toLowerCase();
  const declared = raw === 'application/octet-stream' ? '' : raw;
  if (declared && declared !== byName) throw fileError('RECEIPT_TYPE_MISMATCH', 'The file type does not match the file name. Use a JPG or PNG photo.');
  const actual = sniffImageType(bytes);
  if (!actual) throw fileError('RECEIPT_UNSUPPORTED_CONTENT', 'This file is not a JPG or PNG image.');
  if (actual !== byName) throw fileError('RECEIPT_TYPE_MISMATCH', 'The file content does not match its type. Use a JPG or PNG photo.');
  return actual;
}

/** Normalises an amount string to fixed two decimals ("150" -> "150.00") without ever going through a float. */
export function normaliseAmount(value) {
  const match = AMOUNT.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) return null;
  const whole = match[1].replace(/^0+(?=\d)/, '');
  const cents = (match[2] ?? '').padEnd(2, '0');
  if (/^0+$/.test(whole) && cents === '00') return null;
  return `${whole}.${cents}`;
}

/** Validates the three receipt details (server-side; the form checks the same before sending). */
export function parseReceiptDetails(fields, { today }) {
  const details = {};
  const orNumber = typeof fields.or_number === 'string' ? fields.or_number.trim() : '';
  if (!OR_NUMBER.test(orNumber)) details.or_number = 'Enter the OR number: 1 to 30 letters, digits or dashes.';
  const amount = normaliseAmount(fields.amount);
  if (amount === null) details.amount = 'Enter the amount paid, more than 0, with at most 2 decimals (for example 150.00).';
  const receiptDate = typeof fields.receipt_date === 'string' ? fields.receipt_date.trim() : '';
  if (!isValidManilaDate(receiptDate)) details.receipt_date = 'Enter the date on the receipt.';
  else if (receiptDate > today) details.receipt_date = 'The receipt date cannot be in the future.';
  if (Object.keys(details).length) throw Errors.validation('Please correct the highlighted fields', details);
  return { orNumber, amount, receiptDate };
}

/** Reads the multipart upload (file, or_number, amount, receipt_date) with a hard byte limit. */
export async function readReceiptUpload(request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) throw fileError('RECEIPT_INVALID_UPLOAD', 'Send the receipt photo and its details as a form upload.');
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) throw tooLarge();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let form;
  try {
    form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw fileError('RECEIPT_INVALID_UPLOAD', 'The upload could not be read.');
  }
  const files = form.getAll('file');
  if (files.length !== 1 || typeof files[0] === 'string') throw fileError('RECEIPT_EMPTY_FILE', 'Choose one photo of the receipt.');
  const file = files[0];
  const text = (name) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  return {
    bytes: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    declaredType: file.type,
    fields: { or_number: text('or_number'), amount: text('amount'), receipt_date: text('receipt_date') },
  };
}

/** The receipt as the API shows it to authorised staff. Never the storage key, hash or a URL. */
export function receiptDto(row) {
  return {
    attachment_id: row.attachment_id,
    transaction_id: row.transaction_id,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes),
    or_number: row.or_number,
    amount: row.amount === null ? null : String(row.amount),
    receipt_date: row.receipt_date,
    uploaded_by: row.uploaded_by,
    uploaded_at: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
  };
}

const RECEIPT_COLUMNS = `attachment_id, transaction_id, office_id, status, storage_key, content_type, size_bytes, or_number, amount::text AS amount,
  to_char(receipt_date, 'YYYY-MM-DD') AS receipt_date, uploaded_by, created_at, confirmed_at`;

async function audit(manager, { user, action, transaction, attachment, ipAddress }) {
  await recordAudit(manager, {
    actor: user,
    action,
    entityType: 'transaction',
    entityId: transaction.transaction_id,
    entityName: transaction.tracking_no,
    officeId: transaction.office_id,
    // Ids, type and size only: never the image, its storage key, the OR number, the amount or the date.
    after: { attachment_id: attachment.attachment_id, content_type: attachment.content_type, size_bytes: Number(attachment.size_bytes) },
    ipAddress,
  });
}

/** GET metadata: { receipt } (null when none is attached). */
export async function getReceipt(dataSource, user, transactionId) {
  await loadScopedTransaction(dataSource, user, transactionId);
  const [row] = await dataSource.query(`SELECT ${RECEIPT_COLUMNS} FROM transaction_receipts WHERE transaction_id = $1 AND status = 'ACTIVE'`, [transactionId]);
  return { receipt: row ? receiptDto(row) : null };
}

async function markDeleted(manager, attachmentId, { at, purged = false }) {
  await manager.query(
    `UPDATE transaction_receipts SET status = 'DELETED', deleted_at = $2, or_number = NULL, amount = NULL, receipt_date = NULL,
            storage_purged_at = CASE WHEN $3 THEN $2::timestamptz ELSE storage_purged_at END
      WHERE attachment_id = $1 AND status <> 'DELETED'`,
    [attachmentId, at, purged],
  );
}

/** Upload (see the failure handling above). Returns { receipt }. */
export async function uploadReceipt(dataSource, { storage, now = () => new Date() }, user, transactionId, upload, { ipAddress } = {}) {
  const transaction = await loadScopedTransaction(dataSource, user, transactionId);
  const contentType = checkReceiptFile(upload);
  const details = parseReceiptDetails(upload.fields, { today: toManilaDate(now()) });
  if (storage.kind === 'none') throw storageDown();

  const attachmentId = randomUUID();
  const key = `receipts/${transaction.transaction_id}/${attachmentId}`;
  const at = now();
  await dataSource.transaction(async (manager) => {
    // The transaction row lock serialises two uploads for the same transaction.
    await manager.query('SELECT 1 FROM transactions WHERE transaction_id = $1 FOR UPDATE', [transactionId]);
    const live = await manager.query("SELECT attachment_id, status, created_at FROM transaction_receipts WHERE transaction_id = $1 AND status IN ('PENDING', 'ACTIVE')", [transactionId]);
    for (const row of live) {
      if (row.status === 'ACTIVE') throw Errors.conflict('A receipt is already attached. Delete it first to attach another.', 'RECEIPT_EXISTS');
      if (at.getTime() - new Date(row.created_at).getTime() < STALE_PENDING_MS) throw Errors.conflict('A receipt is being uploaded for this transaction. Try again in a moment.', 'RECEIPT_UPLOAD_IN_PROGRESS');
      await markDeleted(manager, row.attachment_id, { at }); // an interrupted upload: its object (if any) is purged by the cleanup
    }
    await manager.query(
      `INSERT INTO transaction_receipts (attachment_id, transaction_id, office_id, status, storage_key, content_type, size_bytes, sha256, or_number, amount, receipt_date, uploaded_by, created_at)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8, $9::numeric, $10::date, $11, $12)`,
      [attachmentId, transactionId, transaction.office_id, key, contentType, upload.bytes.length, createHash('sha256').update(upload.bytes).digest('hex'),
        details.orNumber, details.amount, details.receiptDate, user.id, at],
    );
  });

  try {
    await storage.put(key, upload.bytes, contentType);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', message: 'Receipt storage write failed', attachment_id: attachmentId, error: err?.name }));
    await markDeleted(dataSource, attachmentId, { at: now() }).catch(() => {});
    throw storageDown();
  }

  let row;
  try {
    row = await dataSource.transaction(async (manager) => {
      const [confirmed] = await manager.query(
        `UPDATE transaction_receipts SET status = 'ACTIVE', confirmed_at = $2 WHERE attachment_id = $1 AND status = 'PENDING' RETURNING ${RECEIPT_COLUMNS}`,
        [attachmentId, now()],
      ).then((r) => (Array.isArray(r[0]) ? r[0] : r));
      if (!confirmed) throw new Error('The reserved receipt row is gone');
      await audit(manager, { user, action: 'RECEIPT_UPLOADED', transaction, attachment: confirmed, ipAddress });
      return confirmed;
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', message: 'Receipt confirmation failed', attachment_id: attachmentId, error: err?.name }));
    let purged = false;
    try {
      await storage.delete(key);
      purged = true;
    } catch { /* the cleanup job deletes it later */ }
    await markDeleted(dataSource, attachmentId, { at: now(), purged }).catch(() => {});
    throw Errors.unavailable('The receipt was not saved. Please try again.', 'RECEIPT_NOT_SAVED');
  }
  kickOutbox();
  return { receipt: receiptDto(row) };
}

/** The image bytes for an authorised viewer. The view is audited (committed) before the bytes are read. */
export async function readReceiptImage(dataSource, { storage }, user, transactionId, { ipAddress } = {}) {
  const transaction = await loadScopedTransaction(dataSource, user, transactionId);
  const [row] = await dataSource.query(`SELECT ${RECEIPT_COLUMNS} FROM transaction_receipts WHERE transaction_id = $1 AND status = 'ACTIVE'`, [transactionId]);
  if (!row) throw notFound();
  if (storage.kind === 'none') throw storageDown();
  await dataSource.transaction((manager) => audit(manager, { user, action: 'RECEIPT_VIEWED', transaction, attachment: row, ipAddress }));
  kickOutbox();
  let bytes;
  try {
    bytes = await storage.get(row.storage_key);
  } catch (err) {
    if (err instanceof StorageUnavailableError) throw storageDown();
    console.error(JSON.stringify({ level: 'error', message: 'Receipt storage read failed', attachment_id: row.attachment_id, error: err?.name }));
    throw storageDown();
  }
  if (!bytes) throw Errors.notFound('The receipt photo could not be found', 'RECEIPT_NOT_FOUND');
  // The stored object must still be the image that was checked at upload.
  if (sniffImageType(bytes) !== row.content_type) throw storageDown();
  return { bytes, contentType: row.content_type, fileName: `receipt-${row.attachment_id}.${EXTENSION_FOR[row.content_type]}` };
}

/** Delete: DELETED + audit in one database transaction, then the object. Returns { deleted: true, storage_purged }. */
export async function deleteReceipt(dataSource, { storage, now = () => new Date() }, user, transactionId, { ipAddress } = {}) {
  const transaction = await loadScopedTransaction(dataSource, user, transactionId);
  const at = now();
  const row = await dataSource.transaction(async (manager) => {
    const [active] = await manager.query(`SELECT ${RECEIPT_COLUMNS} FROM transaction_receipts WHERE transaction_id = $1 AND status = 'ACTIVE' FOR UPDATE`, [transactionId]);
    if (!active) throw notFound();
    await manager.query(
      `UPDATE transaction_receipts SET status = 'DELETED', deleted_at = $2, deleted_by = $3, or_number = NULL, amount = NULL, receipt_date = NULL
        WHERE attachment_id = $1`,
      [active.attachment_id, at, user.id],
    );
    await audit(manager, { user, action: 'RECEIPT_DELETED', transaction, attachment: active, ipAddress });
    return active;
  });
  kickOutbox();
  let purged = false;
  try {
    await storage.delete(row.storage_key);
    await dataSource.query('UPDATE transaction_receipts SET storage_purged_at = $2 WHERE attachment_id = $1', [row.attachment_id, now()]);
    purged = true;
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', message: 'Receipt object delete deferred to cleanup', attachment_id: row.attachment_id, error: err?.name }));
  }
  return { deleted: true, storage_purged: purged };
}

/** Deletes the objects of DELETED and stale PENDING rows that are not purged yet. Idempotent; returns { purged, failed }. */
export async function runReceiptStorageCleanup(dataSource, { storage, now = () => new Date(), limit = 200 } = {}) {
  if (storage.kind === 'none') return { purged: 0, failed: 0, skipped: 'storage not configured' };
  const at = now();
  const rows = await dataSource.query(
    `SELECT attachment_id, status, storage_key FROM transaction_receipts
      WHERE storage_purged_at IS NULL AND (status = 'DELETED' OR (status = 'PENDING' AND created_at < $1))
      ORDER BY created_at LIMIT $2`,
    [new Date(at.getTime() - STALE_PENDING_MS), limit],
  );
  let purged = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await storage.delete(row.storage_key);
      if (row.status === 'PENDING') await markDeleted(dataSource, row.attachment_id, { at, purged: true });
      else await dataSource.query('UPDATE transaction_receipts SET storage_purged_at = $2 WHERE attachment_id = $1 AND storage_purged_at IS NULL', [row.attachment_id, at]);
      purged += 1;
    } catch {
      failed += 1;
    }
  }
  return { purged, failed };
}
