// Rules for the Audit Log viewer, as pure functions (no React, no network), so they can be tested directly.
// The Logs service owns who may read the log and what each filter means; this checks input early, explains
// the service's answers, and turns the stored before/after values into safe, readable text. The viewer never
// changes or removes an entry.
import { formatDate, formatDateTime, formatTime } from './date-format.js';

export const EMPTY_AUDIT_FILTERS = Object.freeze({ actor: '', action: '', entity_type: '', from: '', to: '' });

export const FORBIDDEN_MESSAGE = 'You do not have permission to view the audit log.';
export const SERVER_ERROR_MESSAGE = 'The audit log could not be loaded right now. Please try again in a few minutes.';
export const RANGE_MESSAGE = 'From date must be on or before To date';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_LIMIT = 80;

/** Early feedback on the filters (the service checks again). Returns { field: message } and is empty when they are fine. */
export function auditFilterErrors(filters) {
  const errors = {};
  const actor = filters.actor.trim();
  if (actor && !UUID.test(actor)) errors.actor = 'Actor must be a user ID, for example 3f2b9c1a-0d4e-4b7a-9c21-5e8f6a7b1c2d.';
  if (filters.action.trim().length > TEXT_LIMIT) errors.action = `Action must be ${TEXT_LIMIT} characters or fewer.`;
  if (filters.entity_type.trim().length > TEXT_LIMIT) errors.entity_type = `Entity type must be ${TEXT_LIMIT} characters or fewer.`;
  if (filters.from && !formatDate(filters.from)) errors.from = 'From must be a valid date (MM/DD/YYYY).';
  if (filters.to && !formatDate(filters.to)) errors.to = 'To must be a valid date (MM/DD/YYYY).';
  if (!errors.from && !errors.to && filters.from && filters.to && filters.from > filters.to) errors.from = `${RANGE_MESSAGE}.`;
  return errors;
}

/** A failed request as { message, fieldErrors }: the page banner text, and messages for the filter fields the service named. */
export function auditErrorResult(err) {
  const status = err?.status;
  if (status === 403) return { message: FORBIDDEN_MESSAGE, fieldErrors: {} };
  if (status === 400 && err.details && typeof err.details === 'object') {
    const fieldErrors = {};
    const labels = { actor: 'Actor', action: 'Action', entity_type: 'Entity type', from: 'From', to: 'To' };
    for (const [field, label] of Object.entries(labels)) if (typeof err.details[field] === 'string') fieldErrors[field] = err.details[field].startsWith(label) ? err.details[field] : `${label}: ${err.details[field]}`;
    if (Object.keys(fieldErrors).length) return { message: null, fieldErrors };
  }
  if (err?.code === 'NETWORK_ERROR') return { message: err.message, fieldErrors: {} };
  if (status === 401) return { message: 'Your session has ended. Please sign in again.', fieldErrors: {} };
  if (status >= 500) return { message: SERVER_ERROR_MESSAGE, fieldErrors: {} };
  return { message: err?.message ?? 'Something went wrong. Please try again.', fieldErrors: {} };
}

/** How many pages there are, never less than 1. */
export const auditPageCount = (total, pageSize) => Math.max(1, Math.ceil(total / pageSize));

/** The actor of an entry: the user ID, or "System" for the system's own entries. */
export function actorOf(event) {
  if (event.actor_user_id) return event.actor_user_id;
  return event.actor_role === 'system' ? 'System' : '';
}

/** The start of a long ID for the table; the whole ID stays in the title and in the details. */
export const shortId = (id) => (typeof id === 'string' && id.length > 13 ? `${id.slice(0, 8)}…` : (id ?? ''));

// ---- The single search box ----
// The Logs service has no free-text search: it filters on an exact user ID (actor), an exact action and an exact
// entity type, one request at a time. So the one search box reads what was typed as ONE of those, in this order:
// a user ID; a name already seen in the log (entity type, then action); a lowercase word (entity types are written
// that way, like "account"); anything else as an action, written the way actions are stored ("account created" ->
// ACCOUNT_CREATED). The page says which one it used. Actor names are not searchable: the log holds no names.

export const SEARCH_LIMIT = TEXT_LIMIT;
export const SEARCH_FIELD_LABELS = { actor: 'User ID', action: 'Action', entity_type: 'Entity type' };
const LOWERCASE_WORD = /^[a-z][a-z0-9_]*$/;

/** { filter, field, value }: the filter the typed text stands for ({} when empty) and which one it is. */
export function searchToFilters(text, known = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return { filter: {}, field: null, value: '' };
  if (UUID.test(raw)) return { filter: { actor: raw }, field: 'actor', value: raw };
  const snake = raw.toLowerCase().replace(/[\s-]+/g, '_');
  const knownType = (known.types ?? []).find((type) => type.toLowerCase() === snake);
  if (knownType) return { filter: { entity_type: knownType }, field: 'entity_type', value: knownType };
  const knownAction = (known.actions ?? []).find((action) => action.toLowerCase() === snake);
  if (knownAction) return { filter: { action: knownAction }, field: 'action', value: knownAction };
  if (LOWERCASE_WORD.test(raw)) return { filter: { entity_type: raw }, field: 'entity_type', value: raw };
  const action = raw.toUpperCase().replace(/[\s-]+/g, '_');
  return { filter: { action }, field: 'action', value: action };
}

/** Early feedback on the search text; the service checks again. */
export const searchProblem = (text) => (String(text ?? '').trim().length > SEARCH_LIMIT ? `Search must be ${SEARCH_LIMIT} characters or fewer.` : null);

// ---- Names, only from data the log or the accounts list really holds ----

const NAME_KEYS = ['full_name', 'office_name', 'service_name', 'document_name', 'term_name', 'label', 'tracking_no', 'name'];

/**
 * The name of the thing an entry is about: the Logs service's own entity_name (a transaction's is its tracking number),
 * otherwise a name inside the entry's before/after values. "" when there is none, and the page then says so.
 */
export function entityName(event) {
  if (typeof event?.entity_name === 'string' && event.entity_name.trim()) return event.entity_name.trim();
  for (const value of [event.after_value, event.before_value]) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const key of NAME_KEYS) if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return '';
}

/**
 * The name for an entry's affected record. First its own name (entity_name, or a name inside its before/after values).
 * An older entry with none is looked up by type and ID in lists the page already holds: lookups = { office: Map(id -> name),
 * account: Map(id -> name), service: Map(id -> name) }. Returns "" when nothing safe is found; the page then says the name is
 * unavailable. Transactions are never looked up (only their own tracking number is shown), and citizen details are never read.
 */
export function resolveEntityName(event, lookups = {}) {
  const own = entityName(event);
  if (own) return own;
  const type = String(event?.entity_type ?? '').toLowerCase();
  if (type === 'transaction') return '';
  const found = event?.entity_id ? lookups[type]?.get(event.entity_id) : null;
  return typeof found === 'string' ? found.trim() : '';
}

export const NAME_UNAVAILABLE = 'Name unavailable (older entry)';

/** "transaction_settings" -> "Transaction settings". */
export const entityTypeLabel = (type) => (typeof type === 'string' && type ? humanizeKey(type) : '');

/** user ID -> full name, from the accounts list and from account entries in the log itself. Nothing is invented. */
export function buildNameMap(accounts = [], events = []) {
  const names = new Map();
  for (const account of accounts) if (account?.account_id && account.full_name) names.set(account.account_id, account.full_name);
  for (const event of events) {
    const name = event.entity_type === 'account' && event.entity_id && !names.has(event.entity_id) ? entityName(event) : '';
    if (name) names.set(event.entity_id, name);
  }
  return names;
}

/** "10/23/2026 6:42 PM" -> { date: "10/23/2026", time: "6:42 PM" }, for a two-line cell. */
export function splitDateTime(text) {
  const at = typeof text === 'string' ? text.indexOf(' ') : -1;
  return at < 0 ? { date: text || '', time: '' } : { date: text.slice(0, at), time: text.slice(at + 1) };
}

/** The "Showing 1–20 of 45" numbers from the service's page, page_size and total. */
export function showingRange(page, pageSize, total) {
  if (!total) return { from: 0, to: 0 };
  return { from: (page - 1) * pageSize + 1, to: Math.min(total, page * pageSize) };
}

// ---- Before / after values ----

export const HIDDEN = '[hidden]';
// Citizen details (client_email, client_reference, client_name, student number) are never shown, even if an entry carried them.
const SENSITIVE_KEY = /pass(word|wd)?|secret|token|hash|private[_-]?key|service[_-]?key|authorization|cookie|client[_-]?(email|reference|name)|student[_-]?(no|number)/i;
const TIME_KEY = /(^|_)(opening_time|closing_time|suspended_from)$/;
const MAX_DEPTH = 6;

export function humanizeKey(key) {
  const text = String(key).replace(/[_-]+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : String(key);
}

function leafText(key, value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    if (value === '') return '(empty)';
    if (TIME_KEY.test(key)) return formatTime(value) || value;
    return formatDateTime(value) || formatDate(value) || value;
  }
  return String(value);
}

/**
 * A stored value as a tree the page can draw: { kind: 'empty' } for nothing, { kind: 'leaf', text },
 * { kind: 'list', items } and { kind: 'object', fields: [{ key, label, node }] }. Everything ends up as plain text:
 * dates and times in the CCMS format, keys that look secret as "[hidden]", very deep data cut off.
 */
export function auditValueTree(value, key = '', depth = 0) {
  if (value === null || value === undefined) return { kind: 'empty' };
  if (SENSITIVE_KEY.test(key)) return { kind: 'leaf', text: HIDDEN };
  if (depth >= MAX_DEPTH) return { kind: 'leaf', text: '(more data not shown)' };
  if (Array.isArray(value)) return value.length === 0 ? { kind: 'leaf', text: '(none)' } : { kind: 'list', items: value.map((item) => auditValueTree(item, key, depth + 1)) };
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return { kind: 'leaf', text: '(none)' };
    return { kind: 'object', fields: keys.map((k) => ({ key: k, label: humanizeKey(k), node: auditValueTree(value[k], k, depth + 1) })) };
  }
  return { kind: 'leaf', text: leafText(key, value) };
}
