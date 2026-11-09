// CC048: an office's own working days and hours, with an optional lunch break.
//
// An office with no rows in office_schedules uses the campus schedule (working_hours, CC014); the absence of rows is what
// "uses the campus schedule" means, and nothing is ever copied from the campus into an office. The engine asks this module for
// the schedule that applies to an office (readEffectiveSchedule); the campus schedule itself is still read by schedule.js.
//
// Nothing here is sent to FMS or SCMS: weekly hours stay inside CCMS (the cal-1.0 message and the sync queues are not touched).
// A change is recorded in the audit trail only (OFFICE_SCHEDULE_UPDATED).
import { Errors, isUuid, recordAudit } from 'ccms-shared';
import { MSG, isHHMM, lockCalendar } from './calendar-rules.js';
import { timeToMinutes } from './engine/working-time.js';
import { readSchedule } from './schedule.js';
import { Office, OfficeSchedule, OfficeScheduleVersion } from '../entities/index.js';
import { kickOutbox } from '../outbox.js';

export const OFFICE_SCHEDULE_MSG = Object.freeze({
  OPENING_REQUIRED: 'Opening time is required on a working day',
  CLOSING_REQUIRED: 'Closing time is required on a working day',
  TIME_FORMAT: 'Time must be in 24-hour HH:MM format',
  NON_WORKING_TIMES: 'Opening and closing times must be empty on a non-working day',
  LUNCH_NON_WORKING: 'A non-working day cannot have a lunch break',
  LUNCH_START_REQUIRED: 'Lunch start is required when the office closes for lunch',
  LUNCH_END_REQUIRED: 'Lunch end is required when the office closes for lunch',
  LUNCH_START_INSIDE: 'Lunch must start within the opening hours',
  LUNCH_END_INSIDE: 'Lunch must end within the opening hours',
  LUNCH_END_AFTER_START: 'Lunch end must be after lunch start',
  LUNCH_FLAG: 'closes_for_lunch must be true or false',
  VERSION: 'The schedule version is required (a whole number, 0 or more)',
  STALE: 'This schedule was changed by someone else. Reload it to see the latest version.',
});

/** The office or a 404. Anyone allowed to ask about the schedule may learn that the office exists. */
async function requireOffice(manager, officeId) {
  if (!isUuid(officeId) || !(await manager.getRepository(Office).findOneBy({ officeId }))) {
    throw Errors.notFound('Office not found', 'OFFICE_NOT_FOUND');
  }
}

/** One schedule row as the API shows it (same names as the campus schedule, plus the lunch break). */
export function toOfficeScheduleItem(row) {
  const working = row.isWorking === true;
  const lunch = working && row.closesForLunch === true;
  return {
    day_of_week: row.weekday,
    is_working: working,
    opening_time: working ? row.opensAt : null,
    closing_time: working ? row.closesAt : null,
    closes_for_lunch: lunch,
    lunch_start: lunch ? row.lunchStart : null,
    lunch_end: lunch ? row.lunchEnd : null,
  };
}

/** A campus item with the lunch fields (the campus schedule has no lunch break), so every effective item has one shape. */
const withNoLunch = (item) => ({ ...item, closes_for_lunch: false, lunch_start: null, lunch_end: null });

/** The office's own rows, Sunday first, or null unless it has all seven (no rows, or a broken partial set, means "campus"). */
async function readOwnRows(manager, officeId) {
  const rows = await manager.getRepository(OfficeSchedule).find({ where: { officeId }, order: { weekday: 'ASC' } });
  return rows.length === 7 ? rows : null;
}

/** The version of an office's schedule: its counter, or the rows' own number if the counter is missing. 0 = never configured. */
async function readVersion(manager, officeId, rows) {
  const counter = await manager.getRepository(OfficeScheduleVersion).findOneBy({ officeId });
  return Math.max(counter?.version ?? 0, ...(rows ?? []).map((r) => r.version));
}

/**
 * The schedule the engine must use for an office: its own seven days when it has them, otherwise the campus schedule exactly as
 * CC014 returns it. Items carry day_of_week, is_working, opening_time, closing_time (and, for an office, the lunch break).
 */
export async function readEffectiveSchedule(manager, officeId) {
  if (officeId && isUuid(officeId)) {
    const rows = await readOwnRows(manager, officeId);
    if (rows) return rows.map(toOfficeScheduleItem);
  }
  return readSchedule(manager);
}

/** GET: what the office's schedule is, whether it is its own, and the version to send back with an update. */
export async function getOfficeSchedule(dataSource, officeId) {
  return dataSource.transaction(async (manager) => {
    await requireOffice(manager, officeId);
    return describe(manager, officeId);
  });
}

async function describe(manager, officeId) {
  const rows = await readOwnRows(manager, officeId);
  return {
    office_id: officeId,
    uses_campus_schedule: rows === null,
    version: await readVersion(manager, officeId, rows),
    items: rows ? rows.map(toOfficeScheduleItem) : (await readSchedule(manager)).map(withNoLunch),
  };
}

const fieldOf = (index, name) => `days[${index}].${name}`;

function parseTime(value) {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' ? value.trim() : undefined; // undefined = not text
}

/**
 * Validates the whole PUT body { version, days: [7 items] } and collects EVERY problem before refusing, so the person sees them
 * all at once. A problem is keyed by its field, e.g. 'days[2].closing_time' (index = the day_of_week), or 'days' / 'version'.
 * Returns { version, items } with the seven normalised items, Sunday first.
 */
export function parseOfficeScheduleInput(body) {
  const details = {};
  const version = parseVersion(body?.version);
  if (version === null) details.version = OFFICE_SCHEDULE_MSG.VERSION;
  const items = new Array(7).fill(null);

  if (!Array.isArray(body?.days) || body.days.length !== 7) {
    details.days = 'days must list all 7 days of the week';
  } else {
    for (const day of body.days) {
      const dow = day?.day_of_week;
      if (day === null || typeof day !== 'object' || Array.isArray(day) || !Number.isInteger(dow) || dow < 0 || dow > 6) {
        details.days = 'Each day must be an object with day_of_week from 0 (Sunday) to 6 (Saturday)';
        continue;
      }
      if (items[dow]) {
        details.days = 'Each day of the week must appear exactly once';
        continue;
      }
      items[dow] = parseDay(day, dow, details);
    }
    if (!details.days && items.some((item) => item === null)) details.days = 'days must list all 7 days of the week';
  }

  if (!Object.keys(details).length && !items.some((item) => item.is_working)) details.days = MSG.ONE_WORKING_DAY;
  if (Object.keys(details).length) throw Errors.validation('Please correct the highlighted fields', details);
  return { version, items };
}

function parseVersion(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function parseDay(day, dow, details) {
  const problem = (name, message) => {
    details[fieldOf(dow, name)] ??= message;
  };
  const working = day.is_working;
  if (typeof working !== 'boolean') {
    problem('is_working', 'is_working must be true or false');
    return { day_of_week: dow, is_working: false, opening_time: null, closing_time: null, closes_for_lunch: false, lunch_start: null, lunch_end: null };
  }
  const opening = parseTime(day.opening_time);
  const closing = parseTime(day.closing_time);
  const lunchFlag = day.closes_for_lunch === undefined || day.closes_for_lunch === null ? false : day.closes_for_lunch;
  if (typeof lunchFlag !== 'boolean') problem('closes_for_lunch', OFFICE_SCHEDULE_MSG.LUNCH_FLAG);

  const off = { day_of_week: dow, is_working: false, opening_time: null, closing_time: null, closes_for_lunch: false, lunch_start: null, lunch_end: null };
  if (!working) {
    if (opening !== null || closing !== null) problem(opening !== null ? 'opening_time' : 'closing_time', OFFICE_SCHEDULE_MSG.NON_WORKING_TIMES);
    if (lunchFlag === true) problem('closes_for_lunch', OFFICE_SCHEDULE_MSG.LUNCH_NON_WORKING);
    return off;
  }

  let openMin = null;
  let closeMin = null;
  if (opening === null) problem('opening_time', OFFICE_SCHEDULE_MSG.OPENING_REQUIRED);
  else if (opening === undefined || !isHHMM(opening)) problem('opening_time', OFFICE_SCHEDULE_MSG.TIME_FORMAT);
  else openMin = timeToMinutes(opening);
  if (closing === null) problem('closing_time', OFFICE_SCHEDULE_MSG.CLOSING_REQUIRED);
  else if (closing === undefined || !isHHMM(closing)) problem('closing_time', OFFICE_SCHEDULE_MSG.TIME_FORMAT);
  else closeMin = timeToMinutes(closing);
  if (openMin !== null && closeMin !== null && closeMin <= openMin) problem('closing_time', MSG.CLOSING_AFTER_OPENING);

  const item = { day_of_week: dow, is_working: true, opening_time: opening, closing_time: closing, closes_for_lunch: false, lunch_start: null, lunch_end: null };
  if (lunchFlag !== true) return item; // lunch off: any lunch times that were sent are ignored, and none are kept

  const lunchStart = parseTime(day.lunch_start);
  const lunchEnd = parseTime(day.lunch_end);
  let startMin = null;
  let endMin = null;
  if (lunchStart === null) problem('lunch_start', OFFICE_SCHEDULE_MSG.LUNCH_START_REQUIRED);
  else if (lunchStart === undefined || !isHHMM(lunchStart)) problem('lunch_start', OFFICE_SCHEDULE_MSG.TIME_FORMAT);
  else startMin = timeToMinutes(lunchStart);
  if (lunchEnd === null) problem('lunch_end', OFFICE_SCHEDULE_MSG.LUNCH_END_REQUIRED);
  else if (lunchEnd === undefined || !isHHMM(lunchEnd)) problem('lunch_end', OFFICE_SCHEDULE_MSG.TIME_FORMAT);
  else endMin = timeToMinutes(lunchEnd);

  const hoursKnown = openMin !== null && closeMin !== null && closeMin > openMin;
  if (hoursKnown && startMin !== null && (startMin < openMin || startMin >= closeMin)) problem('lunch_start', OFFICE_SCHEDULE_MSG.LUNCH_START_INSIDE);
  if (hoursKnown && endMin !== null && (endMin > closeMin || endMin <= openMin)) problem('lunch_end', OFFICE_SCHEDULE_MSG.LUNCH_END_INSIDE);
  if (startMin !== null && endMin !== null && endMin <= startMin) problem('lunch_end', OFFICE_SCHEDULE_MSG.LUNCH_END_AFTER_START);

  return { ...item, closes_for_lunch: true, lunch_start: lunchStart, lunch_end: lunchEnd };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function staleConflict(current) {
  return Errors.conflict(OFFICE_SCHEDULE_MSG.STALE, 'OFFICE_SCHEDULE_VERSION_CONFLICT', { version: OFFICE_SCHEDULE_MSG.STALE, current_version: current });
}

/** Locks the office's version counter (creating it at 0 if the office was never configured) and returns the current version. */
async function lockVersion(manager, officeId) {
  await manager.query('INSERT INTO office_schedule_versions (office_id, version) VALUES ($1, 0) ON CONFLICT (office_id) DO NOTHING', [officeId]);
  const [row] = await manager.query('SELECT version FROM office_schedule_versions WHERE office_id = $1 FOR UPDATE', [officeId]);
  const rows = await readOwnRows(manager, officeId);
  return { current: Math.max(row.version, ...(rows ?? []).map((r) => r.version)), rows };
}

const auditValue = (state) => ({ uses_campus_schedule: state.uses_campus_schedule, version: state.version, items: state.uses_campus_schedule ? null : state.items });

/**
 * PUT: saves the office's own weekly schedule. The body must carry the version the editor loaded; a different version is a
 * 409 and nothing is written. Saving the schedule an office already has changes nothing (no new version, no audit entry).
 * Every real change takes the next version, writes one OFFICE_SCHEDULE_UPDATED audit event and queues nothing for FMS or SCMS.
 */
export async function updateOfficeSchedule(dataSource, actor, officeId, body, { ipAddress } = {}) {
  const input = parseOfficeScheduleInput(body ?? {});
  const result = await dataSource.transaction(async (manager) => {
    await requireOffice(manager, officeId);
    await lockCalendar(manager);
    const { current } = await lockVersion(manager, officeId);
    if (input.version !== current) throw staleConflict(current);

    const before = await describe(manager, officeId);
    if (!before.uses_campus_schedule && same(before.items, input.items)) return before;

    const next = current + 1;
    await manager.getRepository(OfficeSchedule).delete({ officeId });
    await manager.getRepository(OfficeSchedule).insert(
      input.items.map((item) => ({
        officeId,
        weekday: item.day_of_week,
        isWorking: item.is_working,
        opensAt: item.opening_time,
        closesAt: item.closing_time,
        closesForLunch: item.closes_for_lunch,
        lunchStart: item.lunch_start,
        lunchEnd: item.lunch_end,
        version: next,
      })),
    );
    await manager.getRepository(OfficeScheduleVersion).update({ officeId }, { version: next });
    const after = await describe(manager, officeId);
    await recordAudit(manager, { actor, action: 'OFFICE_SCHEDULE_UPDATED', entityType: 'office_schedule', entityId: officeId, officeId, before: auditValue(before), after: auditValue(after), ipAddress });
    return after;
  });
  kickOutbox();
  return result;
}

/**
 * DELETE: the office goes back to the campus schedule (its own rows are removed). The version it had when the editor loaded it
 * must still be current (else 409). An office that already uses the campus schedule is left as it is.
 */
export async function resetOfficeSchedule(dataSource, actor, officeId, { version, ipAddress } = {}) {
  const expected = parseVersion(version);
  if (expected === null) throw Errors.validation('Please correct the highlighted fields', { version: OFFICE_SCHEDULE_MSG.VERSION });
  const result = await dataSource.transaction(async (manager) => {
    await requireOffice(manager, officeId);
    await lockCalendar(manager);
    const { current, rows } = await lockVersion(manager, officeId);
    if (expected !== current) throw staleConflict(current);
    if (!rows) return describe(manager, officeId);

    const before = await describe(manager, officeId);
    const next = current + 1;
    await manager.getRepository(OfficeSchedule).delete({ officeId });
    await manager.getRepository(OfficeScheduleVersion).update({ officeId }, { version: next });
    const after = await describe(manager, officeId);
    await recordAudit(manager, { actor, action: 'OFFICE_SCHEDULE_UPDATED', entityType: 'office_schedule', entityId: officeId, officeId, before: auditValue(before), after: auditValue(after), ipAddress });
    return after;
  });
  kickOutbox();
  return result;
}
