import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { AppError, Errors } from './errors.js';
import { isUuid } from './http.js';

// =================================================================================================================
// Sprint 5 TT2: the analytics event feed from Operations to Oversight (spec 2.2; decisions K14, K16, K28).
//
// This module is THE contract. The Operations producer (live events), the Operations export (backfill pages), the
// Oversight ingest endpoint and the Oversight backfill all build and check payloads with the functions below, so a
// field can only change here.
//
// ---- Transport envelope (one live event) -------------------------------------------------------------------------
//   {
//     "event_id":       uuid      unique per delivery row in Operations' analytics_outbox (a retry re-sends the same id)
//     "event_type":     one of ANALYTICS_EVENT_TYPES
//     "schema_version": 1         ANALYTICS_SCHEMA_VERSION; a receiver rejects any other value
//     "occurred_at":    ISO-8601 instant with an offset (when the Operations database transaction made the event)
//     "snapshot":       a complete analytics snapshot (below), never a delta
//   }
//   Unknown properties are rejected at every level.
//
// ---- Ingest batch: POST {Oversight}/api/analytics-events (service key only) --------------------------------------
//   request   { "events": [envelope, ...] }       0 to 500 events (ANALYTICS_MAX_BATCH); body at most 1 MiB
//   response  { "accepted": n, "applied": n, "ignored": n }
//             accepted = events in the batch; applied = rows inserted or replaced; ignored = events whose version was
//             not higher than the stored one (duplicates, older versions) or that lost to a higher version in the
//             same batch. An empty batch is valid and answers zeros. The whole batch is validated before any write,
//             and it is written in one database transaction: either every event is processed or none is.
//
// ---- Export page: GET {Operations}/api/transactions/analytics-export?limit=&cursor= (service key only) ----------
//   response  { "schema_version": 1, "items": [snapshot, ...], "next_cursor": string | null }
//             items are ordered by transaction_id (immutable); next_cursor is opaque and null on the last page.
//
// ---- Snapshot fields (exactly these; every one is required to be present, nullable ones may be null) ------------
//   transaction_id           uuid
//   tracking_no              text 1-60, no control characters
//   office_id                uuid
//   service_id               uuid
//   service_code             text 1-200, no control characters
//   classification           SIMPLE | COMPLEX | HIGHLY_TECHNICAL            (source: service_classification)
//   client_type              STUDENT | ALUMNI | EMPLOYEE | EXTERNAL
//   standard_days            integer >= 0                                   (source: standard_duration_days)
//   standard_hours           integer >= 0                                   (source: standard_duration_hours)
//   standard_minutes         integer >= 0                                   (source: standard_duration_minutes)
//   started_at               ISO-8601 instant
//   ended_at                 ISO-8601 instant | null                        (null until completed; stays null on cancel/auto-close)
//   status                   IN_PROGRESS | ON_HOLD | COMPLETED | CANCELLED | AUTO_CLOSED
//   elapsed_working_minutes  integer >= 0 | null                            null = result not computed yet ("pending")
//   is_compliant             boolean | null                                 null = pending (never turned into false)
//   variance_minutes         integer | null                                 null = pending; may be negative
//   held_minutes             integer >= 0                                   persisted total of completed holds
//   is_backdated             boolean
//   started_outside_hours    boolean                                        (CC051)
//   registry_status          MATCHED | EXPIRED | NOT_FOUND | NONE           (CC044) NONE until registry capture exists
//   registry_miss_reason     OLDER_ALUMNI | NEW_ENROLLEE | RETURNING_STUDENT | NAME_DIFFERS | OTHER | null
//                            a reason CODE only (never the note); only allowed with NOT_FOUND or EXPIRED
//   outcome                  GRANTED | DISAPPROVED | null                   (CC050) null = not recorded (old rows)
//   started_by_user_id       uuid                                           staff ACCOUNT id (K28), source started_by
//   ended_by_user_id         uuid | null                                    staff ACCOUNT id (K28), source ended_by
//   counter_id               uuid | null
//   event_version            integer 0..2147483647
//   queue_wait_minutes       integer >= 0 | null, OPTIONAL                  (CC040) whole minutes from the queue ticket's original
//                            issue to the Start; null = no ticket linked (or a row from before CC040). The only optional field:
//                            an older producer, an older outbox row, a replay or a backfill page without it reads as null. The
//                            producer leaves it out while it is null, so a receiver that predates CC040 still accepts those.
//                            Never part of compliance: deadline, hold and on-time results do not read it.
//   The three result fields are either all null (pending) or all set.
//
// ---- Never in a snapshot ------------------------------------------------------------------------------------------
//   client reference, email, name, student number, registry student number; every free-text reason or note
//   (backdate, hold, cancel, disapproval, registry note); staff names and positions; IP addresses; service and office
//   names. Staff ACCOUNT ids are present only for future per-staff figures (CC036): never shown to the Executive (K14)
//   and never a model input (K28). Snapshots are built field by field (snapshotFromTransactionRow); nothing is spread.
//
// ---- Version policy -----------------------------------------------------------------------------------------------
//   event_version comes from transactions.analytics_event_version, a counter used ONLY by this feed (not the optimistic
//   lock column `version`). Every emitted snapshot increments it by one inside the same database transaction as the
//   business change, under that row's lock, so the versions of one transaction are strictly increasing in commit order.
//   Rows that existed before TT2 have version 0 and are exported with 0; their first later event is version 1.
//   Oversight keeps, per transaction_id, the snapshot with the highest event_version. An equal or lower version is a
//   no-op (nothing is written, not even a timestamp). The export reads the same counter and the same columns, so the
//   export and the live event of one version describe the same state. Two different snapshots with the same
//   transaction_id and version cannot be produced (Operations enforces UNIQUE (transaction_id, event_version)); if a
//   batch nevertheless contains them, the batch is rejected (400 CONFLICTING_DUPLICATE) and nothing is written; against
//   a stored row with the same version, the stored row stays (first accepted wins, never arrival order).
// =================================================================================================================

export const ANALYTICS_SCHEMA_VERSION = 1;
export const ANALYTICS_MAX_BATCH = 500;
export const ANALYTICS_MAX_BODY_BYTES = 1024 * 1024;
export const ANALYTICS_MAX_VERSION = 2_147_483_647;

export const ANALYTICS_EVENT_TYPES = Object.freeze([
  'TRANSACTION_STARTED',
  'TRANSACTION_HELD',
  'TRANSACTION_RESUMED',
  'TRANSACTION_COMPLETED',
  'TRANSACTION_RESULT_COMPUTED',
  'TRANSACTION_CANCELLED',
  'TRANSACTION_AUTO_CLOSED',
]);

export const ANALYTICS_ENUMS = Object.freeze({
  status: Object.freeze(['IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'AUTO_CLOSED']),
  classification: Object.freeze(['SIMPLE', 'COMPLEX', 'HIGHLY_TECHNICAL']),
  client_type: Object.freeze(['STUDENT', 'ALUMNI', 'EMPLOYEE', 'EXTERNAL']),
  registry_status: Object.freeze(['MATCHED', 'EXPIRED', 'NOT_FOUND', 'NONE']),
  registry_miss_reason: Object.freeze(['OLDER_ALUMNI', 'NEW_ENROLLEE', 'RETURNING_STUDENT', 'NAME_DIFFERS', 'OTHER']),
  outcome: Object.freeze(['GRANTED', 'DISAPPROVED']),
});

const INT_MAX = 2_147_483_647;
const INT_MIN = -2_147_483_648;

// type: uuid | text | enum | int | bool | instant; nullable; min/max for numbers; max for text.
export const ANALYTICS_SNAPSHOT_FIELDS = Object.freeze({
  transaction_id: { type: 'uuid' },
  tracking_no: { type: 'text', max: 60 },
  office_id: { type: 'uuid' },
  service_id: { type: 'uuid' },
  service_code: { type: 'text', max: 200 },
  classification: { type: 'enum' },
  client_type: { type: 'enum' },
  standard_days: { type: 'int', min: 0 },
  standard_hours: { type: 'int', min: 0 },
  standard_minutes: { type: 'int', min: 0 },
  started_at: { type: 'instant' },
  ended_at: { type: 'instant', nullable: true },
  status: { type: 'enum' },
  elapsed_working_minutes: { type: 'int', min: 0, nullable: true },
  is_compliant: { type: 'bool', nullable: true },
  variance_minutes: { type: 'int', min: INT_MIN, nullable: true },
  held_minutes: { type: 'int', min: 0 },
  is_backdated: { type: 'bool' },
  started_outside_hours: { type: 'bool' },
  registry_status: { type: 'enum' },
  registry_miss_reason: { type: 'enum', nullable: true },
  outcome: { type: 'enum', nullable: true },
  started_by_user_id: { type: 'uuid' },
  ended_by_user_id: { type: 'uuid', nullable: true },
  counter_id: { type: 'uuid', nullable: true },
  event_version: { type: 'int', min: 0, max: ANALYTICS_MAX_VERSION },
  // CC040: optional (absent = null) so snapshots from before CC040 stay valid.
  queue_wait_minutes: { type: 'int', min: 0, nullable: true, optional: true },
});
export const ANALYTICS_SNAPSHOT_FIELD_NAMES = Object.freeze(Object.keys(ANALYTICS_SNAPSHOT_FIELDS));

const ENVELOPE_FIELDS = Object.freeze(['event_id', 'event_type', 'schema_version', 'occurred_at', 'snapshot']);
const BATCH_FIELDS = Object.freeze(['events']);
const EXPORT_PAGE_FIELDS = Object.freeze(['schema_version', 'items', 'next_cursor']);

// An instant must carry its own offset so the value never depends on a server's time zone.
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_REPORTED_ERRORS = 50;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

/** A collected validation failure: 400 VALIDATION_ERROR with details keyed by path (at most 50 reported). */
export class AnalyticsValidationError extends AppError {
  constructor(details, code = 'VALIDATION_ERROR', message = 'The analytics payload is invalid') {
    super(400, code, message, details);
    this.name = 'AnalyticsValidationError';
  }
}

function collector() {
  const details = {};
  let count = 0;
  return {
    details,
    add(path, message) {
      count += 1;
      if (count <= MAX_REPORTED_ERRORS) details[path] = message;
    },
    get count() {
      return count;
    },
  };
}

function checkKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.add(path ? `${path}.${key}` : key, 'Unknown property');
  }
}

function normaliseInstant(value) {
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value.trim())) return undefined;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function checkField(name, spec, value, path, errors) {
  const where = `${path}${name}`;
  if (value === null) {
    if (!spec.nullable) errors.add(where, 'Must not be null');
    return null;
  }
  switch (spec.type) {
    case 'uuid':
      if (!isUuid(value)) errors.add(where, 'Must be a UUID');
      return typeof value === 'string' ? value.toLowerCase() : value;
    case 'text':
      if (typeof value !== 'string' || !value.trim() || value.length > spec.max || CONTROL.test(value)) {
        errors.add(where, `Must be text of 1 to ${spec.max} characters without control characters`);
      }
      return value;
    case 'enum':
      if (!ANALYTICS_ENUMS[name].includes(value)) errors.add(where, `Must be one of ${ANALYTICS_ENUMS[name].join(', ')}`);
      return value;
    case 'int': {
      const max = spec.max ?? INT_MAX;
      if (!Number.isInteger(value) || value < spec.min || value > max) errors.add(where, `Must be a whole number from ${spec.min} to ${max}`);
      return value;
    }
    case 'bool':
      if (typeof value !== 'boolean') errors.add(where, 'Must be true or false');
      return value;
    case 'instant': {
      const iso = normaliseInstant(value);
      if (iso === undefined) errors.add(where, 'Must be an ISO-8601 instant with a time zone offset');
      return iso ?? value;
    }
    default:
      throw new Error(`Unknown analytics field type ${spec.type}`);
  }
}

function checkSnapshot(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.add(path.replace(/\.$/, '') || 'snapshot', 'Must be a JSON object');
    return null;
  }
  checkKeys(value, ANALYTICS_SNAPSHOT_FIELD_NAMES, path.replace(/\.$/, ''), errors);
  const out = {};
  for (const [name, spec] of Object.entries(ANALYTICS_SNAPSHOT_FIELDS)) {
    if (!Object.hasOwn(value, name)) {
      if (!spec.optional) errors.add(`${path}${name}`, 'Is required');
      continue;
    }
    out[name] = checkField(name, spec, value[name], path, errors);
    // An optional field that is null is left out of the normalised copy (absent and null mean the same: not measured), so a
    // stored or re-sent payload stays readable by a receiver that predates the field.
    if (spec.optional && out[name] === null) delete out[name];
  }
  const results = [out.elapsed_working_minutes, out.is_compliant, out.variance_minutes];
  if (results.some((v) => v === null) && results.some((v) => v !== null && v !== undefined)) {
    errors.add(`${path}elapsed_working_minutes`, 'elapsed_working_minutes, is_compliant and variance_minutes are all null (pending) or all set');
  }
  if (out.registry_miss_reason != null && !['NOT_FOUND', 'EXPIRED'].includes(out.registry_status)) {
    errors.add(`${path}registry_miss_reason`, 'A miss reason is only allowed when registry_status is NOT_FOUND or EXPIRED');
  }
  return out;
}

function throwIfAny(errors) {
  if (errors.count) {
    const details = errors.details;
    if (errors.count > MAX_REPORTED_ERRORS) details._truncated = `${errors.count - MAX_REPORTED_ERRORS} more problem(s) not listed`;
    throw new AnalyticsValidationError(details);
  }
}

/** Validates one snapshot strictly and returns a normalised copy (instants as UTC ISO strings, UUIDs lower case). */
export function validateAnalyticsSnapshot(value) {
  const errors = collector();
  const out = checkSnapshot(value, '', errors);
  throwIfAny(errors);
  return out;
}

function checkEnvelope(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.add(path.replace(/\.$/, ''), 'Must be a JSON object');
    return null;
  }
  checkKeys(value, ENVELOPE_FIELDS, path.replace(/\.$/, ''), errors);
  for (const name of ENVELOPE_FIELDS) if (!Object.hasOwn(value, name)) errors.add(`${path}${name}`, 'Is required');
  if (Object.hasOwn(value, 'event_id') && !isUuid(value.event_id)) errors.add(`${path}event_id`, 'Must be a UUID');
  if (Object.hasOwn(value, 'event_type') && !ANALYTICS_EVENT_TYPES.includes(value.event_type)) {
    errors.add(`${path}event_type`, `Must be one of ${ANALYTICS_EVENT_TYPES.join(', ')}`);
  }
  if (Object.hasOwn(value, 'schema_version') && value.schema_version !== ANALYTICS_SCHEMA_VERSION) {
    errors.add(`${path}schema_version`, `Must be ${ANALYTICS_SCHEMA_VERSION}`);
  }
  const occurredAt = Object.hasOwn(value, 'occurred_at') ? normaliseInstant(value.occurred_at) : undefined;
  if (Object.hasOwn(value, 'occurred_at') && occurredAt === undefined) errors.add(`${path}occurred_at`, 'Must be an ISO-8601 instant with a time zone offset');
  const snapshot = Object.hasOwn(value, 'snapshot') ? checkSnapshot(value.snapshot, `${path}snapshot.`, errors) : null;
  return {
    event_id: typeof value.event_id === 'string' ? value.event_id.toLowerCase() : value.event_id,
    event_type: value.event_type,
    schema_version: value.schema_version,
    occurred_at: occurredAt,
    snapshot,
  };
}

/** Validates one envelope strictly and returns a normalised copy. */
export function validateAnalyticsEvent(value) {
  const errors = collector();
  const out = checkEnvelope(value, '', errors);
  throwIfAny(errors);
  return out;
}

/**
 * Validates a complete ingest batch before anything is written: shape, size (0-500), every event, and same-version
 * conflicts. Returns the normalised events in their original order.
 */
export function validateAnalyticsBatch(body) {
  const errors = collector();
  if (!isPlainObject(body)) throw new AnalyticsValidationError({ body: 'Must be a JSON object' });
  checkKeys(body, BATCH_FIELDS, '', errors);
  if (!Array.isArray(body.events)) {
    errors.add('events', 'Must be an array');
    throwIfAny(errors);
  }
  if (body.events.length > ANALYTICS_MAX_BATCH) {
    throw new AnalyticsValidationError({ events: `At most ${ANALYTICS_MAX_BATCH} events per batch` }, 'BATCH_TOO_LARGE', `At most ${ANALYTICS_MAX_BATCH} events per batch`);
  }
  const events = body.events.map((event, i) => checkEnvelope(event, `events[${i}].`, errors));
  throwIfAny(errors);
  assertNoConflictingDuplicates(events.map((e) => e.snapshot));
  return events;
}

/** Validates an export page from Operations (used by the backfill). Returns { items, next_cursor }. */
export function validateAnalyticsExportPage(body, { maxItems = ANALYTICS_MAX_BATCH } = {}) {
  const errors = collector();
  if (!isPlainObject(body)) throw new AnalyticsValidationError({ body: 'Must be a JSON object' });
  checkKeys(body, EXPORT_PAGE_FIELDS, '', errors);
  if (body.schema_version !== ANALYTICS_SCHEMA_VERSION) errors.add('schema_version', `Must be ${ANALYTICS_SCHEMA_VERSION}`);
  if (!Array.isArray(body.items)) {
    errors.add('items', 'Must be an array');
    throwIfAny(errors);
  }
  if (body.items.length > maxItems) errors.add('items', `At most ${maxItems} items per page`);
  const cursor = body.next_cursor;
  if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 200)) errors.add('next_cursor', 'Must be a cursor string or null');
  const items = body.items.slice(0, maxItems).map((item, i) => checkSnapshot(item, `items[${i}].`, errors));
  throwIfAny(errors);
  assertNoConflictingDuplicates(items);
  return { items, next_cursor: cursor };
}

const sameSnapshot = (a, b) => ANALYTICS_SNAPSHOT_FIELD_NAMES.every((name) => a[name] === b[name]);

function assertNoConflictingDuplicates(snapshots) {
  const seen = new Map();
  for (const snapshot of snapshots) {
    const key = `${snapshot.transaction_id}:${snapshot.event_version}`;
    const earlier = seen.get(key);
    if (earlier && !sameSnapshot(earlier, snapshot)) {
      throw new AnalyticsValidationError(
        { transaction_id: snapshot.transaction_id, event_version: snapshot.event_version },
        'CONFLICTING_DUPLICATE',
        'Two different snapshots share one transaction_id and event_version',
      );
    }
    seen.set(key, snapshot);
  }
}

/**
 * Keeps, per transaction_id, the snapshot with the highest event_version (validated input). Identical duplicates
 * collapse. Returns the survivors sorted by transaction_id (a stable lock order for the bulk upsert) and how many
 * were dropped.
 */
export function latestSnapshotPerTransaction(snapshots) {
  const best = new Map();
  for (const snapshot of snapshots) {
    const current = best.get(snapshot.transaction_id);
    if (!current || snapshot.event_version > current.event_version) best.set(snapshot.transaction_id, snapshot);
  }
  const latest = [...best.values()].sort((a, b) => (a.transaction_id < b.transaction_id ? -1 : a.transaction_id > b.transaction_id ? 1 : 0));
  return { latest, superseded: snapshots.length - latest.length };
}

/**
 * K16: a seeded row has 9001-9999 as the final, exactly four-digit, dash-separated part of its tracking number
 * (for example PUP-REG-20261015-9001). Anything malformed is not seeded. Derived by the receiver; never trusted from input.
 */
export function isSeededTrackingNo(trackingNo) {
  if (typeof trackingNo !== 'string') return false;
  const match = /-(\d{4})$/.exec(trackingNo);
  if (!match) return false;
  const value = Number(match[1]);
  return value >= 9001 && value <= 9999;
}

// ---- Producer side (Operations) -----------------------------------------------------------------------------------

/**
 * The only transactions columns the producer and the export read. Client reference/email, every reason column, staff
 * names/positions, service/office names and receipt columns are deliberately absent.
 * CC044: transactions.registry_status / registry_miss_reason (a reason CODE column) are read (migration
 * 1794528100000-Cc044RegistryAtStart must run before this code is deployed).
 */
export const ANALYTICS_SOURCE_COLUMNS = Object.freeze([
  'transaction_id', 'tracking_no', 'office_id', 'service_id', 'service_code', 'service_classification', 'client_type',
  'standard_duration_days', 'standard_duration_hours', 'standard_duration_minutes', 'started_at', 'ended_at', 'status',
  'elapsed_working_minutes', 'is_compliant', 'variance_minutes', 'held_minutes', 'is_backdated', 'started_outside_hours',
  'outcome', 'started_by', 'ended_by', 'counter_id', 'analytics_event_version',
  // CC044: status and reason CODE only. Never registry_student_number or registry_miss_note.
  'registry_status', 'registry_miss_reason',
  // CC040: the measured queue wait only (never the ticket id or number). A baseline column, so this list reads on every schema.
  'queue_wait_minutes',
]);

const isoOrNull = (value) => (value === null || value === undefined ? null : new Date(value).toISOString());
const nullable = (value) => (value === undefined ? null : value);

/**
 * Maps one Operations transactions row (or a row with at least ANALYTICS_SOURCE_COLUMNS) to a snapshot, field by field,
 * and validates it. Pending results stay null; a missing outcome stays null; without persisted registry fields the
 * registry status is NONE with no reason (registry capture is not implemented yet, CC044).
 */
export function snapshotFromTransactionRow(row) {
  const hasRegistry = row.registry_status !== undefined && row.registry_status !== null;
  const snapshot = {
    transaction_id: row.transaction_id,
    tracking_no: row.tracking_no,
    office_id: row.office_id,
    service_id: row.service_id,
    service_code: row.service_code,
    classification: row.service_classification,
    client_type: row.client_type,
    standard_days: row.standard_duration_days,
    standard_hours: row.standard_duration_hours,
    standard_minutes: row.standard_duration_minutes,
    started_at: isoOrNull(row.started_at),
    ended_at: isoOrNull(row.ended_at),
    status: row.status,
    elapsed_working_minutes: nullable(row.elapsed_working_minutes),
    is_compliant: nullable(row.is_compliant),
    variance_minutes: nullable(row.variance_minutes),
    held_minutes: row.held_minutes ?? 0,
    is_backdated: row.is_backdated === true,
    started_outside_hours: row.started_outside_hours === true,
    registry_status: hasRegistry ? row.registry_status : 'NONE',
    registry_miss_reason: hasRegistry ? nullable(row.registry_miss_reason) : null,
    outcome: nullable(row.outcome),
    started_by_user_id: row.started_by,
    ended_by_user_id: nullable(row.ended_by),
    counter_id: nullable(row.counter_id),
    event_version: row.analytics_event_version,
  };
  // CC040: present only when measured (see the contract above).
  if (row.queue_wait_minutes !== null && row.queue_wait_minutes !== undefined) snapshot.queue_wait_minutes = row.queue_wait_minutes;
  return validateAnalyticsSnapshot(snapshot);
}

/** Builds a validated envelope for a snapshot. */
export function buildAnalyticsEvent({ eventType, snapshot, eventId = randomUUID(), occurredAt = new Date() }) {
  return validateAnalyticsEvent({
    event_id: eventId,
    event_type: eventType,
    schema_version: ANALYTICS_SCHEMA_VERSION,
    occurred_at: new Date(occurredAt).toISOString(),
    snapshot,
  });
}

// ---- Export cursor -------------------------------------------------------------------------------------------------

/** Opaque keyset cursor: base64url of {"v":1,"after":"<transaction_id>"}. */
export function encodeAnalyticsCursor(afterTransactionId) {
  return Buffer.from(JSON.stringify({ v: 1, after: afterTransactionId }), 'utf8').toString('base64url');
}

/** Decodes and validates a cursor. Throws 400 INVALID_CURSOR for anything that is not one of ours. */
export function decodeAnalyticsCursor(cursor) {
  const invalid = () => Errors.badRequest('The cursor is not valid', { cursor: 'Use the next_cursor value of the previous page' }, 'INVALID_CURSOR');
  if (typeof cursor !== 'string' || cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  let value;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (!isPlainObject(value) || Object.keys(value).length !== 2 || value.v !== 1 || !isUuid(value.after)) throw invalid();
  return value.after.toLowerCase();
}

// ---- HTTP helpers --------------------------------------------------------------------------------------------------

/** A service base URL that ends in /api exactly once ("http://x:3002" and "http://x:3002/api/" both work). */
export function serviceApiBase(raw) {
  const value = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return null;
  return value.endsWith('/api') ? value : `${value}/api`;
}

/** Reads a JSON object body of at most `maxBytes` (413 PAYLOAD_TOO_LARGE beyond it; 400 for malformed JSON). */
export async function readBoundedJson(request, maxBytes = ANALYTICS_MAX_BODY_BYTES) {
  const tooLarge = () => new AppError(413, 'PAYLOAD_TOO_LARGE', `The request body must be ${Math.floor(maxBytes / 1024)} KB or smaller`);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  const reader = request.body?.getReader?.();
  const chunks = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  if (!text.trim()) throw Errors.validation('Request body is required');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw Errors.badRequest('Request body must be a valid JSON object', null, 'INVALID_JSON');
  }
  if (!isPlainObject(value)) throw Errors.badRequest('Request body must be a valid JSON object', null, 'INVALID_JSON');
  return value;
}
