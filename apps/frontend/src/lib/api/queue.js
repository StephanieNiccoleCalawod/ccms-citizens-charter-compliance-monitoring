// CC039 queue, as the browser calls it through the gateway.
//   Public (no login):
//     GET  /api/catalogue/public/offices                    the offices a walk-in may choose (office_id, office_code, office_name)
//     POST /api/operations/queue/public/tickets             { office_id, priority_group? } -> 201 { ticket_no, office_code, office_name,
//                                                            lane, queue_date, issued_at, waiting_ahead }; 400 by field; 429 + Retry-After; 503
//   Staff (Office Head / Office Staff: their office; Super Admin: the office named):
//     GET  /api/operations/queue?office_id=                  { called: [ticket], waiting: [ticket in call order], counts, grace_seconds, now }
//     POST /api/operations/queue/tickets                     { office_id?, priority_group? } -> 201 the issued ticket (same sequence as the public page)
//     POST /api/operations/queue/call-next                   { office_id? } -> { queue_empty, ticket }
//     POST /api/operations/queue/tickets/:id/skip            { version } -> { ticket } (409 SKIP_TOO_EARLY with details.skippable_at)
import { apiFetch, toQuery } from './client.js';
import { OPERATIONS_API } from './operations.js';

export const QUEUE_API = `${OPERATIONS_API}/queue`;
export const PUBLIC_TICKET_API = `${QUEUE_API}/public/tickets`;

export class QueueApiError extends Error {
  constructor(message, { status = 0, code = null, details = null, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = 'QueueApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Takes a ticket without an account. Only the office and the optional priority group are ever sent. */
export async function takeTicket({ office_id: officeId, priority_group: group }, fetchImpl = fetch) {
  const body = { office_id: officeId };
  if (group) body.priority_group = group;
  let response;
  try {
    response = await fetchImpl(PUBLIC_TICKET_API, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new QueueApiError('Cannot reach the server. Check your connection and try again.');
  }
  if (response.ok) return response.json();
  let payload = null;
  try { payload = await response.json(); } catch { /* not JSON */ }
  const wait = Number(response.headers?.get?.('retry-after'));
  throw new QueueApiError(payload?.error?.message || 'Something went wrong. Please try again in a few minutes.', {
    status: response.status,
    code: payload?.error?.code ?? null,
    details: payload?.error?.details ?? null,
    retryAfterSeconds: Number.isFinite(wait) && wait > 0 ? wait : null,
  });
}

export const getQueueBoard = (officeId, fetcher = apiFetch) => fetcher(`${QUEUE_API}${toQuery({ office_id: officeId })}`);
export const issueStaffTicket = (body, fetcher = apiFetch) => fetcher(`${QUEUE_API}/tickets`, { method: 'POST', body });
export const callNextTicket = (officeId, fetcher = apiFetch) => fetcher(`${QUEUE_API}/call-next`, { method: 'POST', body: officeId ? { office_id: officeId } : {} });
export const skipQueueTicket = (ticketId, version, fetcher = apiFetch) =>
  fetcher(`${QUEUE_API}/tickets/${encodeURIComponent(ticketId)}/skip`, { method: 'POST', body: version ? { version } : {} });
