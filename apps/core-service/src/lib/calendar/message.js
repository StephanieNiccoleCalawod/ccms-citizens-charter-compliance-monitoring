import { createHash } from 'node:crypto';
import { isValidManilaDate } from 'ccms-shared';
import { occurrencesInRange } from './engine/recurrence.js';

// Calendar message cal-1.0 (FMS contract, locked by FMS 10/30/2026). This file is the ONLY place that decides what a
// calendar message looks like. The envelope names below come from the contract text we were given:
//   messageId, schemaVersion "cal-1.0", entityId, entityRevision, changeKind UPSERT | REMOVE,
//   appliesTo, interval { start, end, allDay }, effect, mode.
// The remaining names (entryType, date, description, officeId) are PROPOSED: they were not named in the task text.
// If the FMS document names them differently, change them here and nowhere else.

export const SCHEMA_VERSION = 'cal-1.0';
export const CHANGE_KIND = Object.freeze({ UPSERT: 'UPSERT', REMOVE: 'REMOVE' });

/** WORK -> ["WORK"], CLASSES -> ["CLASSES"], BOTH -> ["CLASSES","WORK"]. Never missing. */
const APPLIES_TO = Object.freeze({ WORK: ['WORK'], CLASSES: ['CLASSES'], BOTH: ['CLASSES', 'WORK'] });
export const appliesToList = (appliesTo) => [...(APPLIES_TO[appliesTo] ?? APPLIES_TO.BOTH)];

/** Thrown when a part-day entry has a start but no end: such an entry is never sent (EB4). */
export class IncompleteEntryError extends Error {
  constructor(entryId) {
    super('A part-day calendar entry needs both a start and an end time');
    this.name = 'IncompleteEntryError';
    this.code = 'CALENDAR_ENTRY_INCOMPLETE';
    this.entryId = entryId;
  }
}

// Recurring entries are sent as one dated entry per date (FMS scenario 3). Which dates: the FMS term
// (AY 2026-2027 1st Semester, 2026-08-17 to 2026-12-22) unless CAL_WINDOW_FROM / CAL_WINDOW_TO say otherwise.
export const DEFAULT_WINDOW = Object.freeze({ from: '2026-08-17', to: '2026-12-22' });

export function calendarWindow(env = process.env) {
  const from = env.CAL_WINDOW_FROM;
  const to = env.CAL_WINDOW_TO;
  const ok = isValidManilaDate(from ?? '') && isValidManilaDate(to ?? '') && from <= to;
  return ok ? { from, to } : { ...DEFAULT_WINDOW };
}

const affectsClasses = (entry) => entry.applies_to !== 'WORK';

/** The dates an entry produces messages for: its own date, or every occurrence inside the window when recurring. */
export function occurrenceDates(entry, window) {
  return entry.is_recurring ? occurrencesInRange(entry, window.from, window.to) : [entry.exception_date];
}

/** Id of one dated entry: the entry's own ID, or "<id>@<date>" for each date of a recurring entry. */
export const entityIdOf = (entry, date) => (entry.is_recurring ? `${entry.exception_id}@${date}` : entry.exception_id);

/** { start, end, allDay } in Asia/Manila (+08:00). A whole day is 00:00 to 24:00; a part day needs both times. */
export function intervalOf(entry, date) {
  if (!entry.suspended_from) {
    return { start: `${date}T00:00:00+08:00`, end: `${date}T24:00:00+08:00`, allDay: true };
  }
  if (!entry.suspended_until) throw new IncompleteEntryError(entry.exception_id);
  return {
    start: `${date}T${entry.suspended_from}:00+08:00`,
    end: `${date}T${entry.suspended_until}:00+08:00`,
    allDay: false,
  };
}

/**
 * One cal-1.0 body (no messageId: the pull route sends it without one, the push adds it). Used for SMS only; FMS
 * receives schema 3 (buildFmsMessage below).
 * `effect` carries a value only when classes are affected and the entry is campus-wide (C42), otherwise null.
 * `mode` is always null ("all classes").
 * A REMOVE of an entry that never had a valid interval carries interval null (identity is all the receiver needs).
 */
export function buildEntry({ entry, date, changeKind }) {
  let interval = null;
  try {
    interval = intervalOf(entry, date);
  } catch (err) {
    if (!(err instanceof IncompleteEntryError) || changeKind !== CHANGE_KIND.REMOVE) throw err;
  }
  const body = {
    schemaVersion: SCHEMA_VERSION,
    entityId: entityIdOf(entry, date),
    entityRevision: entry.revision,
    changeKind,
    entryType: entry.exception_type,
    date,
    description: entry.description ?? '',
    officeId: entry.office_id ?? null,
    appliesTo: appliesToList(entry.applies_to),
    interval,
    mode: null,
    effect: affectsClasses(entry) && !entry.office_id ? entry.class_mode : null,
  };
  return body;
}

/** The push message: the entry body plus the unique messageId (the sync row's own ID, so every retry repeats it). */
export const buildMessage = ({ messageId, ...rest }) => ({ messageId, ...buildEntry(rest) });

// ---- FMS calendar schema 3 ----
// The contract FMS locked (faculty-ms #287, #437): `fms-cccms-calendar-candidate-v3-1`. FMS parses it strictly, so an
// unknown or missing field rejects the whole message. SMS keeps cal-1.0 above.
//
// FMS keys every declaration to one FMS Academic Term ID (`sms:<dataset>:term:<native-id>`, from the FMS/SMS reference
// mapping). CCMS cannot derive it, so the operator sets FMS_TERM_ID; the calendar window (CAL_WINDOW_FROM/TO) is that
// term's dates. Nothing is queued for or served to FMS until FMS_TERM_ID is set.
// shortcut: one FMS term per deployment; add a term_dates -> FMS term ID mapping when FMS needs more than one term.

export const FMS_SCHEMA_VERSION = 3;

/** The FMS term this deployment serves, or null when FMS_TERM_ID is not set. */
export function fmsTarget(env = process.env) {
  const termId = env.FMS_TERM_ID?.trim();
  if (!termId) return null;
  return {
    termId,
    window: calendarWindow(env),
    // The message-format revision FMS records as provenance. FMS compares it when the same entity revision arrives
    // again (push, then pull), so it must not change per deploy: change it only when the message content changes.
    artifactRevision: env.CAL_ARTIFACT_REVISION?.trim() || 'ccms-fms-calendar-v3',
  };
}

export const inFmsTerm = (target, date) => date >= target.window.from && date <= target.window.to;

// FMS refuses control characters, empty text and more than 200 characters in every text field.
const fmsText = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ').trim().slice(0, max);

/** ISO instant with seconds precision (FMS refuses milliseconds). */
export const fmsInstant = (value) => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A stable UUID for a pulled entry (a pull has no sync row): the same entity revision always gets the same ID. */
export function fmsPullMessageId(entityId, revision, changeKind) {
  const hex = createHash('sha256').update(`ccms-fms-pull:${entityId}:${revision}:${changeKind}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * One FMS schema 3 message. A REMOVE carries declaration null (FMS needs only the identity and the higher revision).
 * `mode` is [] ("all classes", stated explicitly). `effect` is always sent: FMS applies SUSPENDED and holds ONLINE
 * for review, so nothing is held back. WORK-only entries carry effect "".
 */
export function buildFmsMessage({ messageId, entry, date, changeKind, target, sourceTimestamp }) {
  const entityId = entityIdOf(entry, date);
  let declaration = null;
  if (changeKind !== CHANGE_KIND.REMOVE) {
    const { start, end, allDay } = intervalOf(entry, date);
    declaration = {
      occurrenceId: entityId,
      ...(entry.is_recurring ? { seriesId: entry.exception_id } : {}),
      appliesTo: appliesToList(entry.applies_to),
      scope: entry.office_id ? 'OFFICE' : 'CAMPUS',
      interval: { startsAt: start, endsAt: end, timeZone: 'Asia/Manila', wholeDay: allDay },
      mode: [],
      effect: affectsClasses(entry) ? (entry.class_mode ?? '') : '',
      entryType: entry.exception_type,
      date,
      description: fmsText(entry.description, 200) || entry.exception_type,
      officeId: entry.office_id ?? null,
    };
  }
  return {
    schemaVersion: FMS_SCHEMA_VERSION,
    messageId,
    entityId,
    entityRevision: entry.revision,
    changeKind,
    sourceTimestamp: fmsInstant(sourceTimestamp),
    scope: { termId: target.termId },
    provenance: { artifactRevision: target.artifactRevision, synthetic: false },
    declaration,
  };
}
