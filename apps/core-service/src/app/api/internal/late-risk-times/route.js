import { Errors, fromManila, json, readJson, requireServiceKey, route, toManilaDate } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { loadCalendar, parseEngineOfficeId, parseInstant } from '../../../../lib/calendar/engine-service.js';
import { computeAddedWorkingMinutes, computeDeadline, computeWorkingMinutes, describeDay } from '../../../../lib/calendar/engine/working-time.js';

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;
const minutesBetween = (calendar, start, end) => end > start ? computeWorkingMinutes(calendar, start, end) : 0;

function sampleAt(calendar, start, end, holds, minutes) {
  let cursor = start;
  let remaining = minutes;
  for (const [from, to] of holds) {
    if (to <= cursor || from >= end) continue;
    const before = minutesBetween(calendar, cursor, from);
    if (remaining < before) break;
    if (remaining === before) return { at: Math.max(cursor, from), onHold: true };
    remaining -= before;
    cursor = Math.min(end, to);
  }
  return { at: Math.min(end, computeAddedWorkingMinutes(calendar, cursor, remaining)), onHold: false };
}

function previousWorkingDays(calendar, date) {
  const result = [];
  const day = fromManila(date).getTime();
  for (let offset = 1; offset <= 366 && result.length < 20; offset += 1) {
    const candidate = toManilaDate(day - offset * DAY);
    if (describeDay(calendar, candidate).is_working_day) result.push(candidate);
  }
  return result;
}

function measure(calendar, input, daysByDate) {
  const start = parseInstant(input.start, 'start', 'Start');
  const end = parseInstant(input.end, 'end', 'End');
  const { days, minutes, elapsed, fraction, heldMinutes = 0 } = input;
  if (end < start || ![days, minutes, heldMinutes].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw Errors.validation('Invalid transaction time or standard');
  }
  const deadline = days ? computeDeadline(calendar, { startMs: start, workingDays: days }) : start;
  const limit = minutesBetween(calendar, start, deadline) + minutes;
  let at = end;
  let onHold = Boolean(input.holdStarted);
  let used = Math.max(0, minutesBetween(calendar, start, input.holdStarted ? parseInstant(input.holdStarted, 'holdStarted', 'Hold start') : end) - heldMinutes);

  if (fraction !== undefined) {
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1 || !Number.isSafeInteger(elapsed) || elapsed < 0 || !Array.isArray(input.holds)) {
      throw Errors.validation('Invalid training sample');
    }
    const holds = input.holds.map(([from, to]) => [parseInstant(from, 'holdStart', 'Hold start'), parseInstant(to, 'holdEnd', 'Hold end')]);
    const target = Math.floor(Math.min(elapsed, limit) * fraction);
    ({ at, onHold } = sampleAt(calendar, start, end, holds, target));
    used = Math.max(0, minutesBetween(calendar, start, at) - holds.reduce((sum, [from, to]) =>
      sum + minutesBetween(calendar, Math.max(start, from), Math.min(at, to)), 0));
  }

  const date = toManilaDate(at);
  if (!daysByDate.has(date)) daysByDate.set(date, previousWorkingDays(calendar, date));
  return { at: new Date(at).toISOString(), used, limit, onHold, workingDays: daysByDate.get(date) };
}

// Operations sends timing inputs only. The calendar stays in Core and is loaded once per office batch.
export const POST = route(async (request) => {
  requireServiceKey(request);
  const { officeId, items } = await readJson(request);
  const office = parseEngineOfficeId(officeId);
  if (!office || !Array.isArray(items) || !items.length || items.length > 60 || items.some((item) => !item || typeof item !== 'object')) {
    throw Errors.validation('Give one office and 1–60 timing items');
  }
  const calendar = await loadCalendar(await getDb(), office);
  const daysByDate = new Map();
  return json({ items: items.map((item) => measure(calendar, item, daysByDate)) });
});
