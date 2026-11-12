// The public complaint routes as the browser calls them: no login, through the gateway.
//   GET  /api/catalogue/public/offices            the active offices (office_id, office_code, office_name) for the form
//   POST /api/logs/complaints                     { office_id, category, description, tracking_no?, name?, email? }
//                                                 -> 201 { reference, status, email_sent }; 400 with details by field; 429; 503
//   GET  /api/logs/complaints/status?ref=         -> { reference, status }; 404 COMPLAINT_NOT_FOUND shows nothing else
import { publicFetch, toQuery } from './client.js';

export const PUBLIC_OFFICES_API = '/api/catalogue/public/offices';
export const COMPLAINTS_API = '/api/logs/complaints';

export class ComplaintApiError extends Error {
  constructor(message, { status = 0, code = null, details = null } = {}) {
    super(message);
    this.name = 'ComplaintApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function errorFrom(response) {
  let body = null;
  try { body = await response.json(); } catch { /* not JSON */ }
  const wait = Number(response.headers?.get?.('retry-after'));
  let message = body?.error?.message;
  if (response.status === 429) message = `${message || 'Too many requests. Please wait a while and try again.'}${wait > 0 ? ` (try again in about ${Math.ceil(wait / 60)} minute${Math.ceil(wait / 60) === 1 ? '' : 's'})` : ''}`;
  return new ComplaintApiError(message || 'Something went wrong. Please try again in a few minutes.', { status: response.status, code: body?.error?.code ?? null, details: body?.error?.details ?? null });
}

export const listPublicOffices = async (fetcher = publicFetch) => (await fetcher(PUBLIC_OFFICES_API)).items ?? [];

/** Sends the complaint. Empty optional fields are left out. */
export async function fileComplaint(values, fetchImpl = fetch) {
  const body = { office_id: values.office_id, category: values.category, description: values.description };
  for (const key of ['tracking_no', 'name', 'email']) if (String(values[key] ?? '').trim()) body[key] = String(values[key]).trim();
  let response;
  try {
    response = await fetchImpl(COMPLAINTS_API, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ComplaintApiError('Cannot reach the server. Check your connection and try again.');
  }
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export async function getComplaintStatus(ref, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${COMPLAINTS_API}/status${toQuery({ ref })}`, { headers: { accept: 'application/json' } });
  } catch {
    throw new ComplaintApiError('Cannot reach the server. Check your connection and try again.');
  }
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}
