// CC046: staff position or designation. A label only: it is shown on screens and in a transaction's "Started by", and it grants nothing.
// Identity checks every rule again; these helpers only keep what the form sends and shows tidy and give the same messages early.

export const POSITION_MAX = 100;
export const POSITION_TOO_LONG = `Position must be ${POSITION_MAX} characters or fewer`;
export const NO_POSITION = '—';
export const NAME_NOT_RECORDED = 'Not recorded';

/** What is saved: the text without leading or trailing spaces ('' when there is nothing). */
export const normalizePosition = (value) => (typeof value === 'string' ? value.trim() : '');

/** The message for a position that Identity would refuse, or null. (Empty is fine: the field is optional.) */
export function positionError(value) {
  return normalizePosition(value).length > POSITION_MAX ? POSITION_TOO_LONG : null;
}

/** "12/100": the length that counts against the limit (without the outer spaces). */
export const positionCounter = (value) => `${normalizePosition(value).length}/${POSITION_MAX}`;

/** For a table cell or a screen: the position, or a neutral dash when there is none. */
export function positionLabel(value) {
  return normalizePosition(value) || NO_POSITION;
}

/** The account form's starting values. A missing position is an empty field, never the word "null". */
export function accountToForm(account) {
  return {
    id: account.account_id,
    employee_no: account.employee_no,
    full_name: account.full_name,
    email: account.email,
    role: account.role,
    office_id: account.office_id ?? '',
    position: account.position ?? '',
    password: '',
  };
}

/**
 * The request body for Add and Edit. `position` is always sent: trimmed text, or null to leave the account without one
 * (on an edit this clears an old position, which is what emptying the field means). Role and office are decided by the caller.
 */
export function accountBody(form, { officeBound }) {
  return {
    employee_no: form.employee_no,
    full_name: form.full_name,
    email: form.email,
    role: form.role,
    office_id: officeBound ? form.office_id || null : null,
    position: normalizePosition(form.position) || null,
  };
}

/** The query for one page of the accounts list. Only filters that have a value are sent; the service matches position in any letter case. */
export function accountsParams({ page, pageSize, q, role, office_id, status, position }) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (normalizePosition(q)) params.set('q', normalizePosition(q));
  if (role) params.set('role', role);
  if (office_id) params.set('office_id', office_id);
  if (status) params.set('status', status);
  if (normalizePosition(position)) params.set('position', normalizePosition(position));
  return params;
}

/**
 * "Started by" on a transaction: the name and position copied when it was started. Old transactions, and ones started while
 * Identity could not be reached, have neither; the screen then says so instead of guessing from the current account.
 */
export function starterLabels(transaction) {
  const name = typeof transaction?.started_by_name === 'string' ? transaction.started_by_name.trim() : '';
  return { name: name || NAME_NOT_RECORDED, hasName: Boolean(name), position: positionLabel(transaction?.started_by_position) };
}
