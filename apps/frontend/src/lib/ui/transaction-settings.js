// Pure rules for the Transaction Settings page and its Counters section (no React, no network of its own),
// so they can be tested directly. The Operations service validates everything again and owns what the
// settings do; nothing here applies a setting to a transaction.
import { ROLES } from 'ccms-shared/roles';
import { createCounter, putSettings, updateCounter } from '../api/operations.js';

export const SETTINGS_CONFLICT_MESSAGE = 'Settings were changed by someone else. Reload and try again.';
export const AUTO_CLOSE_RULE = 'Enter a whole number of working days from 1 to 365, or leave empty to turn auto-close off.';
export const FORBIDDEN_MESSAGE = 'You do not have permission to make this change.';

export const AUTO_CLOSE_FIELDS = [
  { key: 'auto_close_days_simple', label: 'Auto-Close Simple' },
  { key: 'auto_close_days_complex', label: 'Auto-Close Complex' },
  { key: 'auto_close_days_highly_technical', label: 'Auto-Close Highly Technical' },
];

/** Every role can read the settings; only a Super Admin gets the controls that change them (the service answers 403 to anyone else). */
export const canChangeTransactionSettings = (role) => role === ROLES.SUPER_ADMIN;

/** The Counters section: only while Counters Enabled is on, and never for Executive (the service gives them no counters). */
export const showCounters = (settings, role) => settings?.counters_enabled === true && role !== ROLES.EXECUTIVE;

/** What the settings are before anything is loaded or saved: Hold off, Counters off, auto-close off. */
export const DEFAULT_SETTINGS = Object.freeze({
  hold_enabled: false,
  counters_enabled: false,
  auto_close_days_simple: null,
  auto_close_days_complex: null,
  auto_close_days_highly_technical: null,
  version: null,
});

/** The form's state: switches as booleans, auto-close as text ('' = off), so an empty box is never read as 0. */
export function settingsToForm(settings = DEFAULT_SETTINGS) {
  const form = { hold_enabled: settings.hold_enabled === true, counters_enabled: settings.counters_enabled === true };
  for (const { key } of AUTO_CLOSE_FIELDS) form[key] = settings[key] === null || settings[key] === undefined ? '' : String(settings[key]);
  return form;
}

export function sameForm(a, b) {
  return a.hold_enabled === b.hold_enabled && a.counters_enabled === b.counters_enabled && AUTO_CLOSE_FIELDS.every(({ key }) => String(a[key]).trim() === String(b[key]).trim());
}

/** Empty -> { value: null } (auto-close off). A whole number from 1 to 365 -> { value }. Anything else -> { error }. */
export function parseAutoCloseDays(input) {
  const text = String(input ?? '').trim();
  if (text === '') return { value: null };
  if (!/^\d+$/.test(text)) return { error: AUTO_CLOSE_RULE };
  const value = Number(text);
  if (value < 1 || value > 365) return { error: AUTO_CLOSE_RULE };
  return { value };
}

/** { ok: true, body } ready for PUT /settings (with the version that was read), or { ok: false, fieldErrors } naming each invalid field. */
export function prepareSettingsSave(form, version) {
  const body = { hold_enabled: form.hold_enabled === true, counters_enabled: form.counters_enabled === true };
  const fieldErrors = {};
  for (const { key, label } of AUTO_CLOSE_FIELDS) {
    const parsed = parseAutoCloseDays(form[key]);
    if (parsed.error) fieldErrors[key] = `${label}: ${parsed.error}`;
    else body[key] = parsed.value;
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  if (!Number.isInteger(version) || version < 1) return { ok: false, fieldErrors: {}, message: 'The settings have not been loaded yet. Reload and try again.' };
  return { ok: true, body: { ...body, version } };
}

/**
 * Saves the settings. Resolves { ok: true, settings } (the server's answer, with the new version), or
 * { ok: false, kind, message, fieldErrors }: kind is 'invalid' (not sent, or the server's 400), 'conflict' (409: nothing
 * was overwritten), 'forbidden' (403) or 'error'. Never throws.
 */
export async function saveSettings({ form, version, put = putSettings }) {
  const prepared = prepareSettingsSave(form, version);
  if (!prepared.ok) return { ok: false, kind: 'invalid', message: prepared.message ?? null, fieldErrors: prepared.fieldErrors };
  try {
    return { ok: true, settings: await put(prepared.body) };
  } catch (err) {
    if (err?.status === 409) return { ok: false, kind: 'conflict', message: SETTINGS_CONFLICT_MESSAGE, fieldErrors: {} };
    if (err?.status === 403) return { ok: false, kind: 'forbidden', message: FORBIDDEN_MESSAGE, fieldErrors: {} };
    if (err?.status === 400 && err.details && typeof err.details === 'object') {
      const fieldErrors = {};
      for (const { key, label } of AUTO_CLOSE_FIELDS) if (err.details[key]) fieldErrors[key] = `${label}: ${AUTO_CLOSE_RULE}`;
      return { ok: false, kind: 'invalid', message: Object.keys(fieldErrors).length ? null : err.message, fieldErrors };
    }
    return { ok: false, kind: 'error', message: err?.message ?? 'Something went wrong. Please try again.', fieldErrors: {} };
  }
}

// ---- Counters ----

export const COUNTER_LABEL_MAX = 50;
export const LABEL_TAKEN_MESSAGE = 'This office already has a counter with this label. Labels are not case-sensitive, so "Window 1" and "window 1" are the same.';

/** Early feedback only: the server is what guarantees a label is unique per office, in any letter case. */
export function counterLabelProblem(label) {
  const text = String(label ?? '').trim();
  if (!text) return 'Counter label is required';
  if (text.length > COUNTER_LABEL_MAX) return `Counter label must be ${COUNTER_LABEL_MAX} characters or fewer`;
  return null;
}

/** Turns a failed counter request into { fieldErrors, message } for the form or the page. */
export function counterErrorResult(err) {
  const status = err?.status;
  if (status === 409 && err.code === 'COUNTER_LABEL_EXISTS') return { fieldErrors: { label: LABEL_TAKEN_MESSAGE }, message: null };
  if (status === 409 && err.code === 'COUNTER_HAS_OPEN_TRANSACTION') {
    return { fieldErrors: {}, message: 'This counter has an open transaction. Finish or cancel that transaction first, then try again.' };
  }
  if (status === 409 && err.code === 'OFFICE_INACTIVE') return { fieldErrors: {}, message: 'This office is not active, so its counters cannot be changed.' };
  if (status === 403) return { fieldErrors: {}, message: FORBIDDEN_MESSAGE };
  if (status === 404 && err.code === 'COUNTER_NOT_FOUND') return { fieldErrors: {}, message: 'This counter no longer exists. Reload the list.' };
  if (status === 503) return { fieldErrors: {}, message: 'The office service is not available right now. Please try again in a few minutes.' };
  if (status === 400 && err.details && typeof err.details === 'object') {
    const fieldErrors = {};
    for (const key of ['label', 'office_id']) if (typeof err.details[key] === 'string') fieldErrors[key] = err.details[key];
    return { fieldErrors, message: Object.keys(fieldErrors).length ? null : err.message };
  }
  return { fieldErrors: {}, message: err?.message ?? 'Something went wrong. Please try again.' };
}

/** Creates or updates a counter ({ id } present = update). Resolves { ok: true, counter } or { ok: false, fieldErrors, message }. */
export async function saveCounter({ id, office_id, label }, { create = createCounter, update = updateCounter } = {}) {
  const problem = counterLabelProblem(label);
  if (problem) return { ok: false, fieldErrors: { label: problem }, message: null };
  try {
    const trimmed = label.trim();
    const counter = id ? await update(id, { office_id, label: trimmed }) : await create({ office_id, label: trimmed });
    return { ok: true, counter };
  } catch (err) {
    return { ok: false, ...counterErrorResult(err) };
  }
}
