import { Errors, REGISTRY_STATUS_FOR_CLIENT_TYPE, createDbStore, createRateLimiter, recordAudit, toManilaDate } from 'ccms-shared';
import { getDb } from '../../lib/data-source.js';
import { kickOutbox } from '../../lib/outbox.js';

// CC044 (spec 4.2; K5; J13(a)): find a Student or Alumni client in the CC043 registry, at Start.
//
//  - Matching: a complete student number exactly, or a name containing at least three letters, ignoring letter case and
//    accents. Every value is a bound parameter; the name is matched with strpos() on a folded copy, never with LIKE, so
//    % _ and \ in the input are ordinary characters.
//  - At most 10 results, ordered: the exact number first, then names that start with the text, then the rest; within a
//    group by the folded name and then the student number (deterministic).
//  - Results carry what the picker needs to choose and to recognise expiry. Never the registry email.
//  - Audit REGISTRY_SEARCHED: who (the actor), when (server time) and how many results. Never the text, rows or names.
//  - The shared database limiter, 30 per minute per signed-in user, across instances; fail closed.

export const REGISTRY_SEARCH_LIMITS = Object.freeze({ limit: 30, windowMs: 60_000 });
export const REGISTRY_SEARCH_MAX_RESULTS = 10;
export const REGISTRY_QUERY_MAX = 100;
export const REGISTRY_MISS_REASONS = Object.freeze(['OLDER_ALUMNI', 'NEW_ENROLLEE', 'RETURNING_STUDENT', 'NAME_DIFFERS', 'OTHER']);
export const REGISTRY_NOTE_MAX = 200;
export const REGISTRY_NUMBER_MAX = 30;

// Combining marks left by NFD decomposition (accents). Passed as a bound parameter to regexp_replace.
const COMBINING_MARKS = '[̀-ͯ]';
const FOLDED_NAME = "lower(regexp_replace(normalize(full_name, NFD), $3, '', 'g'))";

/** The same folding in JavaScript, for the search text: decomposed, accents removed, lower case, spaces collapsed. */
export function foldName(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const letterCount = (text) => (String(text).match(/\p{L}/gu) ?? []).length;

/** Whether a registry record is past its validity date on the Manila date `today` (alumni without a date never expire). */
export function isRegistryExpired(person, today) {
  if (!person.valid_until) return false;
  const until = person.valid_until instanceof Date ? toManilaDate(person.valid_until) : String(person.valid_until).slice(0, 10);
  return until < today;
}

const STATUS_FILTERS = Object.freeze({ STUDENT: 'ENROLLED', ENROLLED: 'ENROLLED', ALUMNI: 'ALUMNI' });

/**
 * Validates ?q=&status=. Returns { number, needle, status }. Unknown parameters, an empty text, a text of more than 100
 * characters, or a text with fewer than three letters that is not a student number attempt (no digit) are refused.
 */
export function parseSearchQuery(searchParams) {
  const details = {};
  for (const key of searchParams.keys()) if (!['q', 'status'].includes(key)) details[key] = 'Unknown parameter';
  const raw = searchParams.getAll('q');
  const q = raw.length === 1 ? raw[0].normalize('NFC').trim() : '';
  if (raw.length !== 1 || !q) details.q = 'Type a student number or at least three letters of the name';
  else if (q.length > REGISTRY_QUERY_MAX || /[\u0000-\u001f\u007f]/.test(q)) details.q = `Search text must be ${REGISTRY_QUERY_MAX} characters or fewer`;
  const letters = q ? letterCount(q) : 0;
  const hasDigit = /\d/.test(q);
  if (!details.q && letters < 3 && !hasDigit) details.q = 'Type a student number or at least three letters of the name';

  const statusValues = searchParams.getAll('status');
  let status = null;
  if (statusValues.length > 1) details.status = 'Give one status';
  else if (statusValues.length === 1 && statusValues[0] !== '') {
    status = STATUS_FILTERS[statusValues[0]] ?? null;
    if (!status) details.status = 'Status must be STUDENT, ALUMNI or ENROLLED';
  }
  if (Object.keys(details).length) throw Errors.validation('Please correct the search', details);
  return {
    number: q.length <= REGISTRY_NUMBER_MAX ? q : null,
    needle: letters >= 3 ? foldName(q) : null,
    status,
  };
}

function toResult(row, today) {
  return {
    student_number: row.student_number,
    full_name: row.full_name,
    program: row.program,
    year_level: row.year_level ?? null,
    status: row.status,
    valid_until: row.valid_until ?? null,
    is_expired: isRegistryExpired(row, today),
  };
}

/** The search itself: one statement, bound parameters only. `today` is the Manila date used for expiry. */
export async function searchRegistry(queryable, { number, needle, status }, { today }) {
  const rows = await queryable.query(
    `SELECT student_number, full_name, program, year_level, status, valid_until::text AS valid_until
       FROM (SELECT p.*, ${FOLDED_NAME} AS folded FROM registry_people p WHERE ($4::text IS NULL OR p.status = $4)) r
      WHERE r.student_number = $1 OR ($2::text IS NOT NULL AND strpos(r.folded, $2) > 0)
      ORDER BY CASE WHEN r.student_number = $1 THEN 0 WHEN $2::text IS NOT NULL AND left(r.folded, length($2)) = $2 THEN 1 ELSE 2 END,
               r.folded, r.student_number
      LIMIT ${REGISTRY_SEARCH_MAX_RESULTS}`,
    [number, needle, COMBINING_MARKS, status],
  );
  return rows.map((row) => toResult(row, today));
}

const defaultLimiter = createRateLimiter({ store: createDbStore(getDb), failOpen: false });
let limiter = defaultLimiter;
/** Tests replace the limiter; pass null to restore the shared database limiter. */
export function setRegistrySearchLimiter(value) {
  limiter = value ?? defaultLimiter;
}

/**
 * GET /registry/search for an authenticated Office Staff, Office Head or Super Admin.
 * Returns { limited: { retryAfterSeconds } } when over the limit, or { items }. The audit entry is written before the
 * answer: if it cannot be written, nothing is returned (503).
 */
export async function runRegistrySearch(dataSource, actor, searchParams, { now = new Date(), ipAddress = null } = {}) {
  const query = parseSearchQuery(searchParams);
  let check;
  try {
    check = await limiter.check(`registry-search:user:${actor.id}`, REGISTRY_SEARCH_LIMITS);
  } catch {
    throw Errors.unavailable('The registry search is not available right now. You can still continue with "Not in the registry".', 'REGISTRY_UNAVAILABLE');
  }
  if (!check.allowed) return { limited: { retryAfterSeconds: check.retryAfterSeconds } };

  let items;
  try {
    items = await searchRegistry(dataSource, query, { today: toManilaDate(now) });
    await recordAudit(dataSource.manager, {
      actor,
      action: 'REGISTRY_SEARCHED',
      entityType: 'registry_search',
      entityId: null,
      officeId: actor.officeId ?? null,
      after: { result_count: items.length },
      occurredAt: now,
      ipAddress,
    });
  } catch {
    // Database errors can carry query parameters; keep the search text out of the error logger.
    throw Errors.unavailable('The registry search is not available right now. You can still continue with "Not in the registry".', 'REGISTRY_UNAVAILABLE');
  }
  kickOutbox();
  return { items };
}

// ---- Resolution at Start (server-owned) ----------------------------------------------------------------------------

/**
 * Reads the registry part of a Start body. Collects problems into `details`; returns the parsed choice.
 *   registry_student_number   the record the user picked (re-checked by the server, never trusted)
 *   registry_not_found        true = "Not in the registry"
 *   registry_miss_reason      one of REGISTRY_MISS_REASONS
 *   registry_miss_note        private note, 1-200 characters; required with OTHER
 * Any registry_status sent by the browser is ignored: the server decides it.
 */
export function parseRegistryChoice(body, clientType, details) {
  const text = (value) => (typeof value === 'string' ? value.trim() : value);
  const number = text(body.registry_student_number);
  const notFound = body.registry_not_found;
  const reason = text(body.registry_miss_reason);
  const note = text(body.registry_miss_note);
  const present = (value) => value !== undefined && value !== null && value !== '' && value !== false;

  if (!Object.hasOwn(REGISTRY_STATUS_FOR_CLIENT_TYPE, clientType)) {
    // Employee and External clients are never looked up.
    if ([number, notFound, reason, note].some(present)) details.registry = 'The registry applies only to Student and Alumni clients';
    return null;
  }
  // Every new Student or Alumni Start needs a registry pick or "Not in the registry" with a reason (CC044 AC3; Codex
  // finding). There is no "not checked" path for new requests: NONE stays only on historical rows, Employee/External
  // clients and seeded rows written by the import.
  const choice = { studentNumber: null, notFound: false, reason: null, note: null };
  if (present(number)) {
    if (typeof number !== 'string' || number.length > REGISTRY_NUMBER_MAX) details.registry = 'Choose the client again from the registry';
    else choice.studentNumber = number;
  }
  if (present(notFound)) {
    if (notFound !== true) details.registry = 'registry_not_found must be true or left out';
    else choice.notFound = true;
  }
  if (choice.studentNumber && choice.notFound) details.registry = 'Choose a registry record or "Not in the registry", not both';
  if (!choice.studentNumber && !choice.notFound && !details.registry) {
    details.registry = 'Find the client in the registry, or choose "Not in the registry" and give a reason';
  }
  if (present(reason)) {
    if (!REGISTRY_MISS_REASONS.includes(reason)) details.registry_miss_reason = 'Choose a reason from the list';
    else choice.reason = reason;
  }
  if (present(note)) {
    if (typeof note !== 'string' || note.length > REGISTRY_NOTE_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)) {
      details.registry_miss_note = `The note must be ${REGISTRY_NOTE_MAX} characters or fewer`;
    } else choice.note = note;
  }
  if (choice.notFound && !choice.reason && !details.registry_miss_reason) details.registry_miss_reason = 'Choose why the client is not in the registry';
  if (choice.reason === 'OTHER' && !choice.note && !details.registry_miss_note) details.registry_miss_note = 'Describe the reason (up to 200 characters)';
  if (choice.note && !choice.reason && !details.registry_miss_reason) details.registry_miss_reason = 'Choose a reason for the note';
  return choice;
}

const NONE = Object.freeze({ status: 'NONE', studentNumber: null, reason: null, note: null, email: null });

/**
 * Turns the parsed choice into what is saved, against the CURRENT registry and the Manila date of the submission.
 *   picked, right status, still valid  -> MATCHED (canonical number linked; the registry email may fill an empty email)
 *   picked, right status, expired      -> EXPIRED (number linked), reason required
 *   picked but gone / other status     -> NOT_FOUND, reason required
 *   "Not in the registry"              -> NOT_FOUND, reason required (no lookup at all: the manual path always works)
 * A missing reason is a 400 REGISTRY_REASON_REQUIRED that says which status applies, so the user can add it and go on.
 * A lookup failure is a 503 that points to the manual path; it never touches the Start's own database transaction.
 */
export async function resolveRegistryChoice(queryable, clientType, choice, { today }) {
  if (!choice) return NONE;
  if (choice.notFound) return { status: 'NOT_FOUND', studentNumber: null, reason: choice.reason, note: choice.note, email: null };

  let person;
  try {
    [person] = await queryable.query(
      'SELECT student_number, status, valid_until::text AS valid_until, email FROM registry_people WHERE student_number = $1',
      [choice.studentNumber],
    );
  } catch {
    throw Errors.unavailable('The registry could not be checked. Try again, or choose "Not in the registry" to continue.', 'REGISTRY_UNAVAILABLE');
  }
  const wanted = REGISTRY_STATUS_FOR_CLIENT_TYPE[clientType];
  let resolved;
  if (person && person.status === wanted && !isRegistryExpired(person, today)) {
    return { status: 'MATCHED', studentNumber: person.student_number, reason: null, note: null, email: person.email ?? null };
  }
  if (person && person.status === wanted) resolved = { status: 'EXPIRED', studentNumber: person.student_number };
  else resolved = { status: 'NOT_FOUND', studentNumber: null };

  if (!choice.reason) {
    const message = resolved.status === 'EXPIRED'
      ? 'This registry record has expired. Choose a reason to continue.'
      : 'This client is no longer in the registry for this client type. Choose a reason to continue.';
    throw Errors.badRequest(message, { registry_miss_reason: message, registry_status: resolved.status }, 'REGISTRY_REASON_REQUIRED');
  }
  return { ...resolved, reason: choice.reason, note: choice.note, email: null };
}
