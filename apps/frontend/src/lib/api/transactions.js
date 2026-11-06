// Starting a transaction, as the browser calls it through the gateway. Every call takes the fetcher as its last
// argument so tests can pass a fake; the default is the signed-in apiFetch.
//
//   Core (Catalogue), read only:
//     GET  /api/catalogue/services?status=&page=&page_size=   the picker's list. Office Head and Office Staff only ever get
//                                                              active services of their own office; Super Admin gets every
//                                                              office (ask for status=active). page_size is at most 100.
//     GET  /api/catalogue/services/:id/standard               the standard in force today (the server's Manila date when no
//                                                              asOf is given): { standard_id, duration_days, duration_hours,
//                                                              duration_minutes, service_code, service_name, office_id,
//                                                              office_code, classification }.
//                                                              404 STANDARD_NOT_FOUND, 404 SERVICE_NOT_FOUND, 409 SERVICE_INACTIVE,
//                                                              403 for another office (Office Head / Office Staff).
//     GET  /api/catalogue/services/:id                        { service, standards, documents: [{ document_id, document_name,
//                                                              is_mandatory, notes }] }
//   Operations:
//     GET  /api/operations/settings                           counters_enabled (read by every signed-in role)
//     GET  /api/operations/counters?officeId=                 the office's counters { counter_id, office_id, label, is_active }
//     POST /api/operations/transactions                       { service_id, client_type, client_reference?, client_email?,
//                                                              requirements_confirmed: true, counter_id? } -> 201 the transaction
//                                                              (tracking_no, status, ...). The server numbers it, takes the
//                                                              standard itself and writes the audit entry.
//     GET  /api/operations/transactions?status=&counter_id=   used only to name the open transaction after a 409 conflict
//     GET  /api/operations/transactions/:id                   one transaction (Executive 403; Office Staff only their own, Office Head
//                                                              their office, Super Admin any). Carries status, hold_started_at,
//                                                              hold_reason and held_minutes (working minutes, worked out by the server).
//     POST /api/operations/transactions/:id/hold              { reason } (1-500 characters after trimming); needs hold_enabled on
//                                                              (409 HOLD_DISABLED) and status IN_PROGRESS (409 INVALID_STATE).
//     POST /api/operations/transactions/:id/resume            no body; status must be ON_HOLD (409 INVALID_STATE). The server asks
//                                                              Core for the working minutes; if Core is down: 503 CALENDAR_UNAVAILABLE
//                                                              and nothing changes. Works even when hold has since been switched off.
//   A conflict on start names the open transaction as text; the detail screen (/transactions/:id) shows one transaction.
import { apiFetch } from '../auth/session.js';
import { OPERATIONS_API } from './operations.js';
import { SERVICES_API } from './catalogue.js';

export const TRANSACTIONS_API = `${OPERATIONS_API}/transactions`;
export const SERVICE_LIST_PAGE_SIZE = 100;

const serviceUrl = (id) => `${SERVICES_API}/${encodeURIComponent(id)}`;

/** Every active service the person may start (all pages), in the order the service returns them. */
export async function listStartableServices({ isSuperAdmin = false } = {}, fetcher = apiFetch) {
  const items = [];
  for (let page = 1; page <= 50; page += 1) {
    const query = `?${isSuperAdmin ? 'status=active&' : ''}page=${page}&page_size=${SERVICE_LIST_PAGE_SIZE}`;
    const data = await fetcher(`${SERVICES_API}${query}`);
    items.push(...(data.items ?? []).filter((service) => service.is_active !== false));
    if (page * SERVICE_LIST_PAGE_SIZE >= (data.total ?? 0) || (data.items ?? []).length === 0) break;
  }
  return items;
}

/** Every service, active or not (all pages), with its `is_active` kept: for pickers that list inactive ones in gray and disabled. */
export async function listSelectableServices(fetcher = apiFetch) {
  const items = [];
  for (let page = 1; page <= 50; page += 1) {
    const data = await fetcher(`${SERVICES_API}?page=${page}&page_size=${SERVICE_LIST_PAGE_SIZE}`);
    items.push(...(data.items ?? []));
    if (page * SERVICE_LIST_PAGE_SIZE >= (data.total ?? 0) || (data.items ?? []).length === 0) break;
  }
  return items;
}

/** The standard in force today. No asOf: the server uses its own Manila date, so the browser never works one out. */
export const getServiceStandard = (serviceId, fetcher = apiFetch) => fetcher(`${serviceUrl(serviceId)}/standard`);

/** The service with its required-documents checklist. */
export const getServiceDetail = (serviceId, fetcher = apiFetch) => fetcher(serviceUrl(serviceId));

/** POST /transactions. The body is built by buildStartBody(); the answer is the server's transaction. */
export const postTransaction = (body, fetcher = apiFetch) => fetcher(TRANSACTIONS_API, { method: 'POST', body });

/** Open transactions (in progress or on hold) matching the filter, newest first; used to explain a conflict. */
export async function listOpenTransactions({ counterId } = {}, fetcher = apiFetch) {
  const items = [];
  for (const status of ['IN_PROGRESS', 'ON_HOLD']) {
    const query = `?status=${status}${counterId ? `&counter_id=${encodeURIComponent(counterId)}` : ''}&page_size=50`;
    const data = await fetcher(`${TRANSACTIONS_API}${query}`);
    items.push(...(data.items ?? []));
  }
  return items;
}

const transactionUrl = (id) => `${TRANSACTIONS_API}/${encodeURIComponent(id)}`;

/** One transaction as the server holds it now. */
export const getTransaction = (id, fetcher = apiFetch) => fetcher(transactionUrl(id));

/** Puts an in-progress transaction on hold. Only the reason is sent; the server records who and when, and keeps the history. */
export const holdTransaction = (id, reason, fetcher = apiFetch) => fetcher(`${transactionUrl(id)}/hold`, { method: 'POST', body: { reason } });

/** Resumes a held transaction. No body: the server works out the held working minutes. */
export const resumeTransaction = (id, fetcher = apiFetch) => fetcher(`${transactionUrl(id)}/resume`, { method: 'POST' });

/**
 * Completes an in-progress transaction. No body: the server takes the end time from its own clock (the optional
 * ended_at / backdate_reason fields are the separate backdating feature and are not sent). The answer is the
 * transaction with ended_at and, when Core answered, elapsed_working_minutes, is_compliant and variance_minutes
 * (all null while the result is pending).
 */
export const completeTransaction = (id, fetcher = apiFetch, body = undefined) => fetcher(`${transactionUrl(id)}/complete`, body === undefined ? { method: 'POST' } : { method: 'POST', body });
// `body` is undefined for an ordinary completion. For an end time entered by hand it is { ended_at, backdate_reason } (see
// completionBody in ui/backdate.js): the service checks it against the stored start, flags the record and audits it itself.

/**
 * Cancels an in-progress or on-hold transaction. Only the reason is sent (1-500 characters after trimming); the server
 * sets CANCELLED, saves the reason, clears the hold and writes the history. Office Head (own office) and Super Admin only (403 otherwise).
 */
export const cancelTransaction = (id, reason, fetcher = apiFetch) => fetcher(`${transactionUrl(id)}/cancel`, { method: 'POST', body: { reason } });

export const TRANSACTION_PAGE_SIZE = 20;

/**
 * One page of transactions. The service scopes the answer by role (the list is never filtered in the browser):
 * Super Admin all offices (office_id narrows), Office Head their office, Office Staff the ones they started; Executive 403.
 * Filters use the service's own names: status, service_id, counter_id, office_id,
 * q (a tracking number or the start of one), page, page_size (at most 100). The answer is
 * { items, page, page_size, total }, newest start first (ORDER BY started_at DESC), without the client email or reference.
 * Only filters that have a value are sent.
 */
export function listTransactionPage(filters = {}, page = 1, pageSize = TRANSACTION_PAGE_SIZE, fetcher = apiFetch) {
  const params = new URLSearchParams();
  for (const name of ['status', 'service_id', 'counter_id', 'office_id']) {
    const value = typeof filters[name] === 'string' ? filters[name].trim() : '';
    if (value) params.set(name, value);
  }
  const q = typeof filters.q === 'string' ? filters.q.trim() : '';
  if (q) params.set('q', q);
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  return fetcher(`${TRANSACTIONS_API}?${params.toString()}`);
}
