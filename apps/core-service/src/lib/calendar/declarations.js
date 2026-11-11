import { Errors, isValidManilaDate } from 'ccms-shared';
import { CalendarException } from '../entities/index.js';
import { smsTermCode } from './sms-snapshot.js';
import { toExceptionDto } from './exceptions.js';
import { dayIndexOfDate, MAX_SPAN_DAYS } from './engine/working-time.js';
import { occurrencesInRange } from './engine/recurrence.js';
import { CHANGE_KIND, FMS_SCHEMA_VERSION, IncompleteEntryError, SCHEMA_VERSION, buildEntry, buildFmsMessage, entityIdOf, fmsPullMessageId, fmsTarget, inFmsTerm } from './message.js';

// EB6: the snapshot FMS pulls to recover after an outage or a missed message.
//   GET /declarations?fromDate=&untilDate=&cursor=&limit=     (the Gateway shows it as /calendar/declarations)
// Every entry that falls in the range, removals (tombstones) included, as FMS schema 3 messages. A recurring entry gives
// one dated entry per date. The list is ordered by (date, entityId) and cut into pages with an opaque cursor.
// Default page size 100, at most 500 (limit=), at most one year per request. nextCursor is null on the last page.
//
// Fixed cut: the watermark is the sum of every entry's revision. Adding an entry adds 1, and every edit or removal raises
// one revision by 1 (entries are never deleted, removals stay as tombstones), so any change raises it. Each cursor carries
// the watermark it was cut at; when the calendar changed between pages the next page is refused (409
// CALENDAR_SNAPSHOT_CHANGED) and FMS starts again from the first page. A complete read is therefore one consistent cut.
//
// SMS (?term= or from/to with an SMS key) still gets the cal-1.0 listing (listDeclarations).

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;

const encodeCursor = (parts) => Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');

function decodeCursor(value, length) {
  const bad = () => Errors.validation('cursor is not valid', { cursor: 'cursor is not valid' });
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== length || parsed.some((part) => typeof part !== 'string')) throw bad();
    return parsed;
  } catch (err) {
    throw err?.status ? err : bad();
  }
}

function dateParam(value, name) {
  if (typeof value !== 'string' || !isValidManilaDate(value)) {
    throw Errors.validation(`${name} must be a date (YYYY-MM-DD)`, { [name]: `${name} must be a date (YYYY-MM-DD)` });
  }
  return value;
}

function parseQuery(query, fromName, toName, cursorParts) {
  const from = dateParam(query[fromName], fromName);
  const to = dateParam(query[toName], toName);
  if (from > to) throw Errors.validation(`${fromName} must not be after ${toName}`, { [fromName]: `${fromName} must not be after ${toName}` });
  if (dayIndexOfDate(to) - dayIndexOfDate(from) > MAX_SPAN_DAYS) {
    throw Errors.validation(`The range must not be longer than ${MAX_SPAN_DAYS} days`, { [toName]: 'Range is too long' });
  }
  let limit = DEFAULT_PAGE_SIZE;
  if (query.limit !== undefined && query.limit !== null && query.limit !== '') {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw Errors.validation(`limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`, { limit: `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}` });
    }
  }
  const cursor = query.cursor ? decodeCursor(query.cursor, cursorParts) : null;
  return { from, to, limit, cursor };
}

export const parseDeclarationQuery = (query) => parseQuery(query, 'from', 'to', 2);

/**
 * Every dated entry of the range as { date, entityId, body }, ordered by (date, entityId), plus the watermark of the rows
 * it was built from. `build(entry, date, changeKind, row)` turns one dated entry into the body to list.
 */
async function snapshotOf(dataSource, { from, to }, build) {
  const rows = await dataSource.getRepository(CalendarException).find();
  const items = [];
  const incomplete = [];
  let watermark = 0;
  for (const row of rows) {
    watermark += row.revision ?? 1;
    const entry = toExceptionDto(row);
    const changeKind = row.removedAt != null ? CHANGE_KIND.REMOVE : CHANGE_KIND.UPSERT;
    for (const date of occurrencesInRange(entry, from, to)) {
      try {
        items.push({ date, entityId: entityIdOf(entry, date), body: build(entry, date, changeKind, row) });
      } catch (err) {
        if (!(err instanceof IncompleteEntryError)) throw err;
        incomplete.push(entry.exception_id);
      }
    }
  }
  if (incomplete.length) {
    // A part-day entry without an end time is never sent (EB4). The read fails loudly instead of leaving it out silently.
    throw Errors.conflict('Some part-day calendar entries have no end time yet', 'CALENDAR_ENTRY_INCOMPLETE', { entry_ids: [...new Set(incomplete)] });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.entityId.localeCompare(b.entityId));
  return { items, watermark };
}

/** The items after a [date, entityId] cursor. */
const after = (items, cursor) => (cursor ? items.filter((item) => item.date > cursor[0] || (item.date === cursor[0] && item.entityId > cursor[1])) : items);

/** The cal-1.0 snapshot of the range (SMS), ordered, before paging. Exposed for tests and the readiness report. */
export async function buildDeclarations(dataSource, { from, to }) {
  const { items } = await snapshotOf(dataSource, { from, to }, (entry, date, changeKind) => buildEntry({ entry, date, changeKind }));
  return items.map((item) => item.body);
}

export async function listDeclarations(dataSource, query) {
  const { from, to, limit, cursor } = parseDeclarationQuery(query);
  const { items } = await snapshotOf(dataSource, { from, to }, (entry, date, changeKind) => buildEntry({ entry, date, changeKind }));
  const rest = after(items, cursor);
  const page = rest.slice(0, limit);
  const last = page.length ? page[page.length - 1] : null;
  return { schemaVersion: SCHEMA_VERSION, from, to, items: page.map((item) => item.body), nextCursor: rest.length > limit && last ? encodeCursor([last.date, last.entityId]) : null };
}

/** The FMS schema 3 snapshot page. FMS sends fromDate/untilDate; from/to are accepted as older names. */
export async function listFmsDeclarations(dataSource, query, env = process.env) {
  const target = fmsTarget(env);
  if (!target) throw Errors.unavailable('The FMS calendar term is not configured (FMS_TERM_ID)', 'FMS_TERM_NOT_CONFIGURED');
  const named = { ...query, fromDate: query.fromDate ?? query.from, untilDate: query.untilDate ?? query.to };
  const { from, to, limit, cursor } = parseQuery(named, 'fromDate', 'untilDate', 3);
  if (!inFmsTerm(target, from) || !inFmsTerm(target, to)) {
    throw Errors.validation(`The range must lie inside the FMS term (${target.window.from} to ${target.window.to})`, { fromDate: 'Range is outside the FMS term' });
  }
  const { items, watermark } = await snapshotOf(dataSource, { from, to }, (entry, date, changeKind, row) => buildFmsMessage({
    messageId: fmsPullMessageId(entityIdOf(entry, date), entry.revision, changeKind),
    entry, date, changeKind, target,
    sourceTimestamp: row.updatedAt ?? row.createdAt,
  }));
  const mark = String(watermark);
  if (cursor && cursor[0] !== mark) {
    throw Errors.conflict('The calendar changed while it was being read. Start again from the first page', 'CALENDAR_SNAPSHOT_CHANGED');
  }
  const rest = after(items, cursor && cursor.slice(1));
  const page = rest.slice(0, limit);
  const last = page.length ? page[page.length - 1] : null;
  return {
    schemaVersion: FMS_SCHEMA_VERSION,
    snapshotId: `ccms-calendar:${from}:${to}:${mark}`,
    watermark,
    scope: { termId: target.termId, fromDate: from, untilDate: to },
    totalCount: items.length,
    entries: page.map((item) => item.body),
    nextCursor: rest.length > limit && last ? encodeCursor([mark, last.date, last.entityId]) : null,
  };
}

/**
 * `?term=2026-1S` (SMS pulls by term): the date range of that term, from our term list (a term name that is an SMS term code).
 * 2026-MY is understood as 2026-MIDYEAR. An unknown term is a 404.
 */
export async function termRange(dataSource, term) {
  const wanted = smsTermCode(term);
  if (!wanted) throw Errors.validation('term is not a term code', { term: 'term must look like 2026-1S' });
  const rows = await dataSource.query('SELECT term_name, start_date::text AS start_date, end_date::text AS end_date FROM term_dates');
  const found = rows.find((row) => smsTermCode(row.term_name) === wanted);
  if (!found) throw Errors.notFound(`Term ${wanted} was not found`, 'TERM_NOT_FOUND');
  return { from: found.start_date, to: found.end_date };
}
