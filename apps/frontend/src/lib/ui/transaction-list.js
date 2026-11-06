// Rules for the Transactions list, as pure functions (no React, no network, no clock).
// The Operations service decides who sees what (Super Admin all offices, Office Head their office, Office Staff the ones
// they started, Executive nothing), filters, sorts (newest start first) and pages. This only holds what the person typed,
// gives early feedback on the tracking number and explains the answers.
import { statusLabel } from './start-transaction.js';

export const TX_STATUSES = ['IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'AUTO_CLOSED'];
export const STATUS_OPTIONS = TX_STATUSES.map((value) => ({ value, label: statusLabel(value) }));

export const TRACKING_MAX = 60;
export const EMPTY_TX_FILTERS = Object.freeze({ status: '', service_id: '', counter_id: '', office_id: '', q: '' });
export const FILTER_KEYS = Object.keys(EMPTY_TX_FILTERS);

export const LIST_MESSAGES = {
  trackingLong: `The tracking number must be ${TRACKING_MAX} characters or fewer.`,
  sessionEnded: 'Your session has ended. Please sign in again.',
  forbidden: 'You do not have permission to see these transactions.',
  serverError: 'The transactions could not be loaded right now. Please try again in a few minutes.',
  empty: 'No transactions yet.',
  emptyFiltered: 'No transactions match these filters.',
  loadFailed: 'The transactions could not be loaded.',
};

/** Early feedback by field. */
export function filterErrors(filters) {
  const errors = {};
  if (filters.q && filters.q.trim().length > TRACKING_MAX) errors.q = LIST_MESSAGES.trackingLong;
  return errors;
}

/** Only the filters that have a value, trimmed. */
export function activeFilters(filters) {
  const out = {};
  for (const key of FILTER_KEYS) {
    const value = typeof filters?.[key] === 'string' ? filters[key].trim() : '';
    if (value) out[key] = value;
  }
  return out;
}

export const hasFilters = (filters) => Object.keys(activeFilters(filters)).length > 0;

/** The address bar form of the applied filters and page ("?status=COMPLETED&page=2"), so Back from a transaction returns here. */
export function filtersToSearch(filters, page = 1, pageSize = 20) {
  const params = new URLSearchParams(activeFilters(filters));
  if (page > 1) params.set('page', String(page));
  if (pageSize !== 20) params.set('page_size', String(pageSize));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Reads the address bar back into { filters, page, pageSize }. Unknown or malformed values fall back to the defaults. */
export function searchToFilters(search) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const filters = { ...EMPTY_TX_FILTERS };
  for (const key of FILTER_KEYS) filters[key] = (params.get(key) ?? '').slice(0, 100);
  if (filters.status && !TX_STATUSES.includes(filters.status)) filters.status = '';
  const whole = (name, fallback, max) => {
    const raw = params.get(name);
    const n = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
    return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
  };
  return { filters, page: whole('page', 1, 1_000_000), pageSize: [10, 20, 50, 100].includes(whole('page_size', 20, 100)) ? whole('page_size', 20, 100) : 20 };
}

/** A failed list request as { kind, message, fieldErrors }. 403 means the service refused: no rows are shown. */
export function listErrorResult(err) {
  const status = err?.status;
  const none = {};
  if (status === 400 && err.details && typeof err.details === 'object') {
    const fieldErrors = {};
    for (const key of ['q', 'status', 'service_id', 'counter_id', 'office_id']) if (typeof err.details[key] === 'string') fieldErrors[key] = err.details[key];
    if (Object.keys(fieldErrors).length) return { kind: 'validation', message: null, fieldErrors };
  }
  if (status === 401) return { kind: 'auth', message: LIST_MESSAGES.sessionEnded, fieldErrors: none };
  if (status === 403) return { kind: 'forbidden', message: LIST_MESSAGES.forbidden, fieldErrors: none };
  if (err?.code === 'NETWORK_ERROR') return { kind: 'network', message: err.message, fieldErrors: none };
  return { kind: 'server', message: LIST_MESSAGES.serverError, fieldErrors: none };
}

/** The sentence for an empty table. */
export const emptyMessage = ({ error, filtered }) => (error ? LIST_MESSAGES.loadFailed : filtered ? LIST_MESSAGES.emptyFiltered : LIST_MESSAGES.empty);

/**
 * Where "Back to transactions" goes: the list with the filters and page the person had, carried in the address of the
 * transaction as ?back=<the list's search>. Whatever is carried is read back through the same parser as the address bar, so
 * nothing but known filters, a page number and a page size can come out of it.
 */
export function backToListHref(rawBack) {
  const { filters, page, pageSize } = searchToFilters(typeof rawBack === 'string' ? rawBack : '');
  return `/transactions${filtersToSearch(filters, page, pageSize)}`;
}

/** The address of one transaction from the list, remembering the list's current view (empty search: nothing to remember). */
export const transactionHref = (transactionId, listSearch) => `/transactions/${transactionId}${listSearch ? `?back=${encodeURIComponent(listSearch)}` : ''}`;
