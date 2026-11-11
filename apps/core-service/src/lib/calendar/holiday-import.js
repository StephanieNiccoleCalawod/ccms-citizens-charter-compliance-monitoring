import { isValidManilaDate } from 'ccms-shared';
import { CalendarException } from '../entities/index.js';
import { createException, toEngineEntry } from './exceptions.js';
import { entriesConflict } from './engine/recurrence.js';

export const NAGER_URL = (year) => `https://nagerholidays.com/api/v4/Holidays/PH/${year}`;
export const isHolidayYear = (year) => Number.isInteger(year) && year >= 1900 && year <= 2200;

export async function fetchNagerHolidays(year, fetchImpl = fetch) {
  if (!isHolidayYear(year)) throw new Error('year must be a four-digit year, for example 2026');
  const response = await fetchImpl(NAGER_URL(year), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw Object.assign(new Error(`Nager.Date responded ${response.status}`), { status: response.status });
  }
  const holidays = await response.json();
  if (!Array.isArray(holidays)) throw new Error('Nager.Date returned an unexpected response (expected a list)');
  return holidays;
}

/** Audit actor used when no Super Admin is named: a fixed system identity with the Super Admin role. */
export const SYSTEM_ACTOR = Object.freeze({ id: '00000000-0000-0000-0000-000000000000', role: 'super_admin' });

/** Only national public holidays of the Philippines are imported (the same rule as the Holidays tab reference list). */
export function isNationalPublicHoliday(holiday) {
  return holiday?.countryCode === 'PH' && holiday.nationalHoliday === true && Array.isArray(holiday.holidayTypes) && holiday.holidayTypes.includes('Public');
}

/** Maps one Nager.Date holiday to an ordinary campus-wide REGULAR_HOLIDAY entry (not recurring). */
export function mapNagerHoliday(holiday) {
  return {
    exception_date: holiday.date,
    exception_type: 'REGULAR_HOLIDAY',
    description: String(holiday.name ?? holiday.localName ?? '').trim().slice(0, 200),
    office_id: null,
    suspended_from: null,
    is_recurring: false,
  };
}

/**
 * Imports the Philippine public holidays of one year from Nager.Date.
 *   - each holiday becomes an ordinary campus-wide REGULAR_HOLIDAY (is_recurring false), editable by the Super Admin;
 *   - dates that already have a campus-wide entry (one-time or recurring) are skipped, so a re-run adds nothing. A removed entry
 *     (a tombstone, EB3) counts too, so a holiday the Super Admin deleted is not added back; the Super Admin can add it by hand;
 *   - only national public holidays are imported (others are counted in `ignored`);
 *   - dryRun reads and reports but writes nothing.
 * `fetchImpl` is injected so tests never reach the network.
 */
export async function importHolidays(dataSource, { year, dryRun = false, fetchImpl = fetch, actor = SYSTEM_ACTOR, log = () => {} }) {
  const holidays = await fetchNagerHolidays(year, fetchImpl);

  const campusEntries = (await dataSource.getRepository(CalendarException).find()).filter((row) => !row.officeId).map(toEngineEntry);
  const result = { year, dry_run: dryRun, fetched: holidays.length, added: [], skipped: [], invalid: [], ignored: 0 };

  for (const holiday of holidays) {
    if (typeof holiday?.date !== 'string' || !holiday.date.startsWith(`${year}-`) || !isValidManilaDate(holiday.date)) {
      result.invalid.push(holiday?.date ?? null);
      continue;
    }
    if (!isNationalPublicHoliday(holiday)) {
      result.ignored += 1;
      continue;
    }
    const entry = mapNagerHoliday(holiday);
    const existing = campusEntries.find((row) => entriesConflict(row, entry));
    if (existing) {
      result.skipped.push({ date: entry.exception_date, description: entry.description });
      log(`skip ${entry.exception_date} ${entry.description} (campus-wide entry exists)`);
      continue;
    }
    if (!dryRun) {
      const created = await createException(dataSource, actor, { ...entry, reason_category: 'HOLIDAY_PROCLAMATION' });
      campusEntries.push(created);
    }
    result.added.push({ date: entry.exception_date, description: entry.description });
    log(`${dryRun ? 'would add' : 'add'} ${entry.exception_date} ${entry.description}`);
  }
  return result;
}

const manilaYear = (now) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric' }).format(now));

/**
 * Automatic import (setting HOLIDAY_AUTO_IMPORT=true, off by default): the daily calendar-sync job imports the holidays of the
 * current year and the next one, with the same rules and overlap check as importHolidays. A year Nager.Date has no data for (400)
 * or an unreachable service is reported and skipped; it never stops the calendar push. Entries are queued for FMS and SMS like any other.
 */
export async function runHolidayAutoImport(dataSource, { env = process.env, now = new Date(), fetchImpl = fetch, log = () => {} } = {}) {
  if (String(env.HOLIDAY_AUTO_IMPORT ?? '').toLowerCase() !== 'true') return { skipped: true, reason: 'HOLIDAY_AUTO_IMPORT is not true' };
  const thisYear = manilaYear(now);
  const years = [];
  for (const year of [thisYear, thisYear + 1]) {
    try {
      const result = await importHolidays(dataSource, { year, fetchImpl, log });
      years.push({ year, added: result.added.length, skipped: result.skipped.length, ignored: result.ignored });
    } catch (error) {
      // Only the year and a fixed note are reported, never the service's own text.
      years.push({ year, error: error?.status === 400 ? 'NO_DATA_FOR_YEAR' : 'SOURCE_UNAVAILABLE' });
    }
  }
  return { skipped: false, years };
}

/** Parses `--year 2026 [--dry-run] [--actor <user id>]`. */
export function parseArgs(argv) {
  const args = { year: null, dryRun: false, actor: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--year') args.year = Number(argv[(i += 1)]);
    else if (arg.startsWith('--year=')) args.year = Number(arg.slice(7));
    else if (arg === '--actor') args.actor = argv[(i += 1)];
    else if (arg.startsWith('--actor=')) args.actor = arg.slice(8);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(args.year)) throw new Error('Usage: npm run seed:holidays -- --year 2026 [--dry-run]');
  return args;
}

