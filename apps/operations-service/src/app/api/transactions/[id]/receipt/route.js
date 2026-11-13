import { clientIp, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { RECEIPT_ROLES, deleteReceipt, getReceipt, readReceiptUpload, uploadReceipt } from '../../../../../modules/receipts/receipts.js';
import { receiptStorage } from '../../../../../modules/receipts/storage.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// CC045 proof of payment. Office Staff / Office Head of the transaction's office and Super Admin only; Executive is 403 here
// even though it may read the transaction (the role check runs before anything is read). Answers are never cached.
const canUse = requirePermission(RECEIPT_ROLES);
const NO_STORE = { 'cache-control': 'private, no-store' };

// GET /transactions/:id/receipt -> { receipt } (null when none). Details only; the photo is GET .../receipt/image.
export const GET = route(async (request, { params }) => {
  const user = await canUse(request);
  return json(await getReceipt(await getDb(), user, params.id), 200, NO_STORE);
});

// POST /transactions/:id/receipt multipart { file, or_number, amount, receipt_date } -> 201 { receipt }.
export const POST = route(async (request, { params }) => {
  const user = await canUse(request);
  const upload = await readReceiptUpload(request);
  const result = await uploadReceipt(await getDb(), { storage: receiptStorage() }, user, params.id, upload, { ipAddress: clientIp(request) });
  return json(result, 201, NO_STORE);
});

// DELETE /transactions/:id/receipt -> { deleted: true, storage_purged }.
export const DELETE = route(async (request, { params }) => {
  const user = await canUse(request);
  return json(await deleteReceipt(await getDb(), { storage: receiptStorage() }, user, params.id, { ipAddress: clientIp(request) }), 200, NO_STORE);
});
