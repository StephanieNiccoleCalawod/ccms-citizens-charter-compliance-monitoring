// CC045 proof of payment, as the browser calls it through the gateway (Office Staff / Office Head of the office, Super Admin;
// Executive gets 403 and the screen never calls these for an Executive).
//   GET    /api/operations/transactions/:id/receipt         { receipt: { attachment_id, or_number, amount, receipt_date, content_type,
//                                                            size_bytes, uploaded_by, uploaded_at } | null }
//   POST   /api/operations/transactions/:id/receipt         multipart { file, or_number, amount, receipt_date } -> 201 { receipt }
//   DELETE /api/operations/transactions/:id/receipt         { deleted: true, storage_purged }
//   GET    /api/operations/transactions/:id/receipt/image   the photo bytes. Needs the session on EVERY request (Authorization
//                                                            header), so it is fetched here and shown from a local object URL; there
//                                                            is no public or signed link to put in an <img src>.
import { ApiError, apiFetch, getAccessToken, redirectToLogin } from '../auth/session.js';
import { TRANSACTIONS_API } from './transactions.js';

const receiptUrl = (id) => `${TRANSACTIONS_API}/${encodeURIComponent(id)}/receipt`;

export const getReceipt = (transactionId, fetcher = apiFetch) => fetcher(receiptUrl(transactionId));
export const deleteReceipt = (transactionId, fetcher = apiFetch) => fetcher(receiptUrl(transactionId), { method: 'DELETE' });

/** Sends the photo and its details as one form upload. `values` is { file, or_number, amount, receipt_date }. */
export function uploadReceipt(transactionId, values, fetcher = apiFetch) {
  const form = new FormData();
  form.append('file', values.file);
  form.append('or_number', values.or_number.trim());
  form.append('amount', values.amount.trim());
  form.append('receipt_date', values.receipt_date);
  return fetcher(receiptUrl(transactionId), { method: 'POST', body: form });
}

/** The photo as a Blob, fetched with the session (never cached by the browser: the server sends no-store). */
export async function fetchReceiptImage(transactionId, { fetchImpl = fetch, token = getAccessToken } = {}) {
  const bearer = await token();
  if (!bearer) {
    redirectToLogin();
    throw new ApiError('Your session has ended. Please sign in again.', { status: 401, code: 'SESSION_ENDED' });
  }
  let response;
  try {
    response = await fetchImpl(`${receiptUrl(transactionId)}/image`, { headers: { authorization: `Bearer ${bearer}` }, cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', { status: 0, code: 'NETWORK_ERROR' });
  }
  if (!response.ok) {
    let body = null;
    try { body = await response.json(); } catch { /* not JSON */ }
    throw new ApiError(body?.error?.message || 'The receipt photo could not be loaded.', { status: response.status, code: body?.error?.code ?? null });
  }
  return response.blob();
}
