// Service rating (CC057), through the gateway (/api/operations/* reaches Operations).
//   POST /api/operations/ratings                     { code, stars }  public, no account -> 201 { rated, service_name }; 400 by field; 409 code not valid or used; 429
//   GET  /api/operations/ratings/summary?office_id=&from=&to=         { items:[{service_id, service_code, service_name, count, average}], total_count, average }
//   GET  /api/operations/transactions/:id/rating-code                 { code, used }  (staff of the transaction's office)
import { apiFetch } from '../auth/session.js';
import { toQuery } from './client.js';

export const RATINGS_API = '/api/operations/ratings';

export class RatingApiError extends Error {
  constructor(message, { status = 0, code = null, details = null } = {}) {
    super(message);
    this.name = 'RatingApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function submitRating({ code, stars }, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(RATINGS_API, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ code, stars }) });
  } catch {
    throw new RatingApiError('Cannot reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    let body = null;
    try { body = await response.json(); } catch { /* not JSON */ }
    throw new RatingApiError(body?.error?.message || 'Something went wrong. Please try again in a few minutes.', { status: response.status, code: body?.error?.code ?? null, details: body?.error?.details ?? null });
  }
  return response.json();
}

export const getRatingSummary = ({ officeId, from, to } = {}, fetcher = apiFetch) => fetcher(`${RATINGS_API}/summary${toQuery({ office_id: officeId, from, to })}`);
export const getTransactionRatingCode = (id, fetcher = apiFetch) => fetcher(`/api/operations/transactions/${encodeURIComponent(id)}/rating-code`);
