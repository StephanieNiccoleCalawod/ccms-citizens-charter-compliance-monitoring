// Rules for the Start Transaction screen, as pure functions (no React, no network). The Operations service checks
// everything again and owns what matters: the tracking number, the standard copied onto the transaction, the
// one-open-transaction rules and the audit entry. This only gives early feedback and explains the answers.

export const CLIENT_TYPES = [
  { value: 'STUDENT', label: 'Student' },
  { value: 'ALUMNI', label: 'Alumni' },
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'EXTERNAL', label: 'External' },
];

export const STATUS_LABELS = {
  IN_PROGRESS: 'In progress',
  ON_HOLD: 'Pending', // display label only: the stored status value stays ON_HOLD
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  AUTO_CLOSED: 'Auto-closed',
};
export const statusLabel = (status) => STATUS_LABELS[status] ?? status;
export const clientTypeLabel = (value) => CLIENT_TYPES.find((t) => t.value === value)?.label ?? value;

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX = 254;
export const REFERENCE_MAX = 100;

/** The checkbox standing in for "no mandatory documents": the server still needs requirements_confirmed to be true. */
export const NO_DOCUMENTS_KEY = '__no_mandatory_documents__';

export const MESSAGES = {
  service: 'Choose a service.',
  standardMissing: 'The service standard has not loaded, so the transaction cannot be started.',
  clientType: 'Choose the client type.',
  email: 'Enter a valid email address, or leave it empty.',
  emailLong: `Email must be ${EMAIL_MAX} characters or fewer.`,
  reference: `Client reference must be ${REFERENCE_MAX} characters or fewer.`,
  requirements: 'Confirm every required document before starting.',
  counter: 'Choose your counter.',
  forbidden: 'You do not have permission to start a transaction for this service.',
  sessionEnded: 'Your session has ended. Please sign in again.',
  catalogueDown: 'The service catalogue cannot be reached right now. Please try again in a moment.',
  serverError: 'The transaction could not be started right now. Please try again in a few minutes.',
};

// ---- Documents ----

/** The checklist items: one per mandatory document; a single confirmation when the service has none. */
export function requirementItems(documents) {
  const mandatory = (documents ?? []).filter((d) => d.is_mandatory === true);
  if (mandatory.length === 0) return [{ id: NO_DOCUMENTS_KEY, label: 'This service lists no mandatory documents. I confirm nothing required is missing.', notes: null }];
  return mandatory.map((d) => ({ id: d.document_id, label: d.document_name, notes: d.notes ?? null }));
}

export const allConfirmed = (items, checks) => items.length > 0 && items.every((item) => checks?.[item.id] === true);

// ---- The standard, shown as the service gives it ----

const part = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "1 day 2 hours 30 minutes" from the three parts of the standard; zero parts are left out. Nothing is calculated. */
export function formatStandardDuration(standard) {
  if (!standard) return '';
  const days = Number(standard.duration_days ?? 0);
  const hours = Number(standard.duration_hours ?? 0);
  const minutes = Number(standard.duration_minutes ?? 0);
  const parts = [];
  if (days > 0) parts.push(part(days, 'day', 'days'));
  if (hours > 0) parts.push(part(hours, 'hour', 'hours'));
  if (minutes > 0) parts.push(part(minutes, 'minute', 'minutes'));
  return parts.length ? parts.join(' ') : 'No duration set';
}

/** Why the standard could not be loaded, as { kind, message } (kind: none, inactive, forbidden, notfound, unavailable). */
export function standardLoadResult(err) {
  const status = err?.status;
  if (status === 404 && err.code === 'STANDARD_NOT_FOUND') return { kind: 'none', message: 'No standard is in force for this service today, so a transaction cannot be started for it.' };
  if (status === 404) return { kind: 'notfound', message: 'This service no longer exists. Choose another service.' };
  if (status === 409 && err.code === 'SERVICE_INACTIVE') return { kind: 'inactive', message: 'This service is inactive and cannot be started.' };
  if (status === 403) return { kind: 'forbidden', message: MESSAGES.forbidden };
  if (status === 401) return { kind: 'forbidden', message: MESSAGES.sessionEnded };
  if (err?.code === 'NETWORK_ERROR') return { kind: 'unavailable', message: err.message };
  return { kind: 'unavailable', message: 'The service standard could not be loaded right now, so a transaction cannot be started. Please try again.' };
}

// ---- The form ----

export const EMPTY_START_FORM = Object.freeze({ service_id: '', client_type: '', client_reference: '', client_email: '', counter_id: '' });

/** Early feedback, by field: { service, standard, client_type, client_reference, client_email, requirements, counter }. Empty when ready. */
export function startErrors({ form, standard, items, checks, countersEnabled }) {
  const errors = {};
  if (!form.service_id) errors.service = MESSAGES.service;
  else if (!standard) errors.standard = MESSAGES.standardMissing;
  if (!CLIENT_TYPES.some((t) => t.value === form.client_type)) errors.client_type = MESSAGES.clientType;
  const reference = form.client_reference.trim();
  if (reference.length > REFERENCE_MAX) errors.client_reference = MESSAGES.reference;
  const email = form.client_email.trim();
  if (email && email.length > EMAIL_MAX) errors.client_email = MESSAGES.emailLong;
  else if (email && !EMAIL_PATTERN.test(email)) errors.client_email = MESSAGES.email;
  if (!allConfirmed(items, checks)) errors.requirements = MESSAGES.requirements;
  if (countersEnabled && !form.counter_id) errors.counter = MESSAGES.counter;
  return errors;
}

/**
 * The body of POST /transactions, exactly the fields the service accepts. Optional values are left out when empty.
 * There is no tracking number, standard, status or audit field here: the service sets those.
 */
export function buildStartBody({ form, countersEnabled }) {
  const body = { service_id: form.service_id, client_type: form.client_type, requirements_confirmed: true };
  const reference = form.client_reference.trim();
  const email = form.client_email.trim();
  if (reference) body.client_reference = reference;
  if (email) body.client_email = email;
  if (countersEnabled && form.counter_id) body.counter_id = form.counter_id;
  return body;
}

const FIELD_OF = { service_id: 'service', client_type: 'client_type', client_reference: 'client_reference', client_email: 'client_email', requirements_confirmed: 'requirements', counter_id: 'counter', started_at: 'started_at', ended_at: 'ended_at', backdate_reason: 'backdate_reason' };

/** A failed start as { kind, fieldErrors, message }. kind: validation, open, counter_busy, inactive, standard, unavailable, forbidden, auth, notfound, network, server. */
export function startErrorResult(err) {
  const status = err?.status;
  const code = err?.code;
  if (status === 400 && err.details && typeof err.details === 'object') {
    const fieldErrors = {};
    for (const [field, text] of Object.entries(err.details)) if (FIELD_OF[field] && typeof text === 'string') fieldErrors[FIELD_OF[field]] = text;
    if (Object.keys(fieldErrors).length) return { kind: 'validation', fieldErrors, message: null };
  }
  const result = (kind, message) => ({ kind, fieldErrors: {}, message });
  if (status === 401) return result('auth', MESSAGES.sessionEnded);
  if (status === 403) return result('forbidden', MESSAGES.forbidden);
  if (status === 404) return result('notfound', 'This service no longer exists. Reload the list and choose another.');
  if (status === 409 && code === 'OPEN_TRANSACTION_EXISTS') return result('open', 'You already have an open transaction. Complete or hand it over first.');
  if (status === 409 && code === 'COUNTER_BUSY') return result('counter_busy', 'This counter already has an open transaction.');
  if (status === 409 && code === 'SERVICE_INACTIVE') return result('inactive', 'This service is inactive and cannot be started.');
  if (status === 409 && code === 'STANDARD_NOT_IN_FORCE') return result('standard', 'No standard is in force for this service today, so a transaction cannot be started for it.');
  if (status === 503 || status === 502 || status === 504) return result('unavailable', MESSAGES.catalogueDown);
  if (code === 'NETWORK_ERROR') return result('network', err.message);
  if (status >= 500) return result('server', MESSAGES.serverError);
  return result('server', err?.message ?? MESSAGES.serverError);
}

/** The open transaction to name after a conflict: the person's own for OPEN_TRANSACTION_EXISTS, the counter's for COUNTER_BUSY. */
export function conflictTransaction(kind, open, userId) {
  const list = open ?? [];
  if (kind === 'open') return list.find((t) => String(t.started_by) === String(userId)) ?? null;
  return list[0] ?? null;
}

/** What the services in the picker are shown as: "Service name - Office name" (the name alone when the API sent no office name). */
export const serviceOptionLabel = (service) => (service.office_name ? `${service.service_name} - ${service.office_name}` : service.service_name);

/** The services matching the picker's search box (name, code or office name/code), the order unchanged. */
export function filterServices(services, search) {
  const text = String(search ?? '').trim().toLowerCase();
  if (!text) return services;
  return services.filter((s) => `${s.service_name} ${s.service_code} ${s.office_name ?? ''} ${s.office_code ?? ''}`.toLowerCase().includes(text));
}
