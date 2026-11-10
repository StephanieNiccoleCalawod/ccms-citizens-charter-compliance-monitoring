// The Working hours tab: the page (selector, Add button, Current schedule, Records) and the "Add working hours" modal with the weekly
// schedule only. Logic is tested directly; the screens are checked from source (there is no browser here; the real screens were also
// driven in a browser, see the report).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { inWeekOrder, sameRows, toRows } from '../../src/lib/ui/office-schedule.js';
import {
  FOLLOWS_CAMPUS_NOTE,
  PILL_DAYS,
  SAVE_NOTE,
  campusRecord,
  isUniform,
  officeRecord,
  recordCount,
  scheduleRows,
  setLunch,
  setShift,
  sharedError,
  sharedLunch,
  sharedShift,
  toCampusDays,
  toggleSharedLunch,
  togglePill,
  workingDaySet,
} from '../../src/lib/ui/working-hours.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const page = read('src/app/calendar/WorkingHoursScope.js');
const modal = read('src/app/calendar/WorkingHoursModal.js');
const dayRow = read('src/app/calendar/ScheduleDayRow.js');

const item = (dow, working, open = null, close = null, lunch = null) => ({
  day_of_week: dow,
  is_working: working,
  opening_time: working ? open : null,
  closing_time: working ? close : null,
  closes_for_lunch: Boolean(lunch),
  lunch_start: lunch ? lunch[0] : null,
  lunch_end: lunch ? lunch[1] : null,
});
const CAMPUS = [item(0, false), ...[1, 2, 3, 4, 5].map((d) => item(d, true, '08:00', '17:00')), item(6, false)];
const WITH_LUNCH = [item(0, false), ...[1, 2, 3, 4, 5].map((d) => item(d, true, '08:00', '17:00', ['12:00', '13:00'])), item(6, true, '08:00', '12:00')];

describe('the page', () => {
  it('has the "Schedule of" selector and the "+ Add working hours" button side by side', () => {
    assert.match(page, /htmlFor="schedule-scope">Schedule of</);
    assert.match(page, /\+ Add working hours/);
    assert.match(page, /flex flex-wrap items-end justify-between gap-4/);
  });

  it('shows the Current schedule card with the seven day pills, Monday first, and the schedule as one line per row beside it', () => {
    assert.deepEqual(PILL_DAYS.map((d) => d.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    assert.match(page, /<h2 id="current-schedule"[^>]*>Current schedule<\/h2>/);
    assert.match(page, /PILL_DAYS\.map\(\(\{ dow, label \}\)/);
    assert.match(page, /data-testid="current-schedule-text"/);
    assert.match(page, /<ScheduleRows items=\{view\.items\} testId="current-schedule-rows" \/>/);
    assert.match(page, /scheduleRows\(items\)\.map\(\(row\) => \(\s*<li[^>]*data-testid="schedule-row"/);
    assert.match(page, /sm:whitespace-nowrap/, 'each row stays on one line');
  });

  it('Current schedule and Records are two columns side by side from lg (one under the other below), the same height', () => {
    assert.match(page, /const TWO_COLUMNS = 'grid items-stretch gap-4 lg:grid-cols-2'/);
    assert.match(page, /<div className=\{TWO_COLUMNS\} data-testid="schedule-columns">\s*<CurrentSchedule[^>]*\/>\s*<Records /);
    assert.equal([...page.matchAll(/flex h-full flex-col/g)].length, 2, 'both cards fill their column');
    assert.doesNotMatch(page, /HALVES/);
  });

  it('a record shows its title and badge on top and its schedule rows under them, so it fits a half-width card', () => {
    assert.match(page, /<ScheduleRows items=\{record\.items\} \/>/);
    assert.match(page, /space-y-3 px-5 py-4" data-testid="record"/);
  });

  it('shows the Records card with a count badge, each record with its title, when, schedule, a badge and Remove', () => {
    assert.match(page, /<h2 id="records-heading"[^>]*>Records<\/h2>/);
    assert.match(page, /recordCount\(records\.length\)/);
    for (const part of ['record.title', 'record.items', 'record.badge', '>\\s*Remove\\s*<']) assert.match(page, new RegExp(part), part);
    assert.equal(recordCount(0), '0 records');
    assert.equal(recordCount(1), '1 record');
    assert.equal(recordCount(3), '3 records');
  });

  it('the cards have a white background with a border, not the transparent card utility', () => {
    assert.match(page, /const CARD = 'rounded-2xl border border-slate-200 bg-white'/);
    assert.doesNotMatch(page, /className="card\b/);
    assert.doesNotMatch(modal, /className="card\b/);
  });

  it('only a Super Admin gets the Add button and Remove; an Office Head or Executive reads', () => {
    assert.match(page, /const mayEdit = canWrite && canEditOfficeSchedule\(user\.role\);/);
    assert.match(page, /\{mayEdit \? \(\s*<button[^>]*onClick=\{\(\) => setAdding\(true\)\}/);
    assert.match(page, /canRemove=\{canWrite && !isCampus\}/);
    assert.match(page, /\{record\.removable && canRemove \? \(/);
  });

  it('a role offered only the Campus sees no selector, just the label', () => {
    assert.match(page, /options\.length > 1 \? \(/);
    assert.match(page, /Schedule of: Campus/);
  });

  it('the campus records are the saved versions of the campus schedule; an office\'s record is its own schedule, which Remove gives back to the campus', () => {
    assert.match(page, /getCampusHistory\(\)/);
    assert.match(page, /resetOfficeSchedule\(scope, state\.view\.version\)/);
    assert.match(page, /title="Remove this schedule\?"/);
    assert.match(page, /danger/);
    assert.match(page, /No records yet\. \$\{scopeName\} follows the campus schedule\./);
  });

  it('a 409 on Remove shows the "changed by someone else" message with a reload button, and removes nothing', () => {
    assert.match(page, /if \(failure\.kind === 'conflict'\) setConflict\(true\)/);
    assert.match(page, /data-testid="schedule-conflict"/);
    assert.match(page, /Reload latest schedule/);
  });

  it('the explanatory note under Records is only for an empty list: with records there is no "nothing recorded" line', () => {
    assert.match(page, /history\.length === 0 \? 'No working-hours changes recorded yet\.' : ''/);
    assert.match(page, /\{note && records\.length > 0 \? </, 'a note is still allowed under records, but the campus one is now empty then');
  });

  it('has loading, error with retry, and empty states', () => {
    assert.match(page, /Loading the schedule…/);
    assert.match(page, />Try again</);
    assert.match(page, /No working-hours changes recorded yet\./);
  });
});

describe('the "Add working hours" modal: the weekly schedule only', () => {
  it('has the title, an X close icon (not a text link), Cancel, and Save & publish', () => {
    assert.match(modal, /title="Add working hours"/);
    assert.match(modal, /\bshowClose\b/);
    assert.match(modal, />Cancel</);
    assert.match(modal, /Save & publish/);
    const shared = read('src/components/modals/Modal.js');
    assert.match(shared, /aria-label="Close"[\s\S]*<path d="m5 5 10 10M15 5 5 15" \/>/, 'the shared Modal draws the X');
    assert.doesNotMatch(modal, />\s*Close\s*</, 'no text "Close" link');
  });

  it('leaves out the Extra working day and Special hours tabs, and has no tabs at all', () => {
    assert.doesNotMatch(modal, /Extra working day|Special hours|Weekly schedule<|role="tab"/);
    assert.doesNotMatch(page, /Extra working day|Special hours/);
  });

  it('has Applies to, the Working days pills, Shift start and Shift end, and the saving note', () => {
    assert.match(modal, /htmlFor="applies-to">Applies to</);
    assert.match(modal, /<p id="working-days-label" className="label">Working days<\/p>/);
    assert.match(modal, /label="Shift start"/);
    assert.match(modal, /label="Shift end"/);
    assert.equal(SAVE_NOTE, 'Saving creates a new record. Results already computed won\'t change; only later computations follow this schedule. Times are in Asia/Manila.');
    assert.match(modal, /<p>\{SAVE_NOTE\}<\/p>/);
  });

  it('"Applies to" offers the campus and the offices the person may see, and loads the chosen one', () => {
    assert.match(modal, /scopes\.map\(\(s\) => \(\s*<option key=\{s\.value\} value=\{s\.value\}>\{s\.label\}/);
    assert.match(modal, /onChange=\{\(e\) => changeTarget\(e\.target\.value\)\}/);
    assert.match(modal, /disabled=\{saving \|\| scopes\.length < 2\}/);
  });

  it('keeps the office lunch break and the day-by-day hours that CC048 needs, and the campus has no lunch', () => {
    assert.match(modal, /aria-label="Closes for lunch"/);
    assert.match(modal, /\{!isCampus \? \(/);
    assert.match(modal, /Set different hours for specific days/);
    assert.match(modal, /Use the same hours for every working day/);
    assert.match(modal, /showLunch=\{!isCampus\}/);
    assert.match(dayRow, /\{showLunch \? \(/);
  });

  it('an office that follows the campus starts from the campus hours as a draft and says so; nothing is saved until Save & publish', () => {
    assert.match(modal, /own\.uses_campus_schedule \? campus\.items : own\.items/);
    assert.match(modal, /follows the campus schedule now\. This starts from the campus hours; saving gives it a schedule of its own\./);
  });

  it('Save & publish checks the form, shows each message under its field, and sends nothing until confirmed', () => {
    assert.match(modal, /const problems = validateRows\(rows\);\s*if \(Object\.keys\(problems\)\.length > 0\) \{\s*setErrors\(problems\);/);
    assert.match(modal, /<FieldError id="working-days-error">\{errors\.days\}<\/FieldError>/);
    assert.match(modal, /error=\{sharedError\(errors, rows, 'opening_time'\)\}/);
    assert.match(modal, /disabled=\{locked \|\| !anyWorking\}/);
  });

  it('a campus save sends the days only; an office save sends the loaded version; a 409 shows reload and overwrites nothing', () => {
    assert.match(modal, /saveCampusSchedule\(toCampusDays\(rows\)\)/);
    assert.match(modal, /saveOfficeSchedule\(target, \{ version: load\.version, days: toDays\(rows\) \}\)/);
    assert.match(modal, /setConflict\(failure\)/);
    assert.match(modal, /Reload latest schedule/);
    const failed = modal.slice(modal.indexOf('  function failed(err)'), modal.indexOf('  const confirmSave'));
    assert.doesNotMatch(failed, /saveCampusSchedule|saveOfficeSchedule|apply\(/, 'the failure handler neither retries nor replaces the edits');
  });

  it('keeps the unsaved-changes guard and blocks closing while saving', () => {
    assert.match(modal, /dirty=\{dirty\}/);
    assert.match(modal, /onClose=\{saving \? undefined : onClose\}/);
    assert.match(modal, /const run = useSingleSubmit\(\)/);
  });

  it('the page reloads and switches to what was saved, and queues the connected systems only for a campus change', () => {
    assert.match(page, /setScope\(savedScope\);\s*setRefresh\(\(n\) => n \+ 1\);\s*if \(campus\) onChanged\?\.\(\);/);
  });

  it('stays responsive: shift fields side by side from sm, day rows one line from md', () => {
    assert.match(modal, /grid gap-4 sm:grid-cols-2/);
    assert.match(dayRow, /md:grid-cols-\[9rem_1fr_1fr_8rem_1fr_1fr\]/);
    assert.match(modal, /widthClass="max-w-2xl"/);
  });
});

describe('the pills and the shared shift', () => {
  const rows = () => toRows(CAMPUS);

  it('a pill turns a day on with the shared shift, and off with nothing left behind', () => {
    const on = togglePill(rows(), 6);
    const saturday = on.find((r) => r.day_of_week === 6);
    assert.deepEqual([saturday.is_working, saturday.opening_time, saturday.closing_time], [true, '08:00', '17:00']);
    const off = togglePill(on, 1).find((r) => r.day_of_week === 1);
    assert.deepEqual([off.is_working, off.opening_time, off.closing_time, off.closes_for_lunch], [false, '', '', false]);
  });

  it('shift start and end go to every working day and leave closed days alone', () => {
    const changed = setShift(rows(), { opening_time: '09:00', closing_time: '16:00' });
    assert.ok(changed.filter((r) => r.is_working).every((r) => r.opening_time === '09:00' && r.closing_time === '16:00'));
    assert.ok(changed.filter((r) => !r.is_working).every((r) => r.opening_time === '' && r.closing_time === ''));
    assert.deepEqual(sharedShift(changed), { opening_time: '09:00', closing_time: '16:00' });
    assert.deepEqual(sharedShift(rows().map((r) => ({ ...r, is_working: false }))), { opening_time: '08:00', closing_time: '17:00' }, 'the usual hours when nothing is on');
  });

  it('knows when every working day has the same hours (one shift) and when they differ (day by day)', () => {
    assert.equal(isUniform(rows()), true);
    assert.equal(isUniform(toRows(WITH_LUNCH)), false, 'Saturday has different hours');
    assert.equal(isUniform(setShift(rows(), { closing_time: '16:00' })), true);
    assert.equal(isUniform(rows().map((r) => (r.day_of_week === 3 ? { ...r, closing_time: '12:00' } : r))), false);
  });

  it('lunch is turned on or off for every working day together, and a day added later gets the same lunch', () => {
    const on = toggleSharedLunch(rows());
    assert.ok(on.filter((r) => r.is_working).every((r) => r.closes_for_lunch && r.lunch_start === '12:00' && r.lunch_end === '13:00'));
    assert.deepEqual(sharedLunch(on), { on: true, start: '12:00', end: '13:00' });
    const later = togglePill(on, 6).find((r) => r.day_of_week === 6);
    assert.deepEqual([later.closes_for_lunch, later.lunch_start, later.lunch_end], [true, '12:00', '13:00']);
    assert.ok(toggleSharedLunch(on).every((r) => !r.closes_for_lunch));
    assert.ok(setLunch(on, { lunch_end: '13:30' }).filter((r) => r.is_working).every((r) => r.lunch_end === '13:30'));
  });

  it('a problem on any working day shows under the shared field', () => {
    assert.equal(sharedError({ 'days[3].closing_time': 'Closing time must be after opening time' }, rows(), 'closing_time'), 'Closing time must be after opening time');
    assert.equal(sharedError({ 'days[0].closing_time': 'x' }, rows(), 'closing_time'), null, 'a closed day is not on the form');
    assert.equal(sharedError({}, rows(), 'opening_time'), null);
  });

  it('the rows keep their week order and the same-schedule check still works', () => {
    assert.deepEqual(inWeekOrder(rows()).map((r) => r.day_of_week), [1, 2, 3, 4, 5, 6, 0]);
    assert.equal(sameRows(rows(), rows()), true);
    assert.equal(sameRows(rows(), setShift(rows(), { closing_time: '16:00' })), false);
  });

  it('the campus request carries only the days and hours, as Core has always accepted', () => {
    const days = toCampusDays(toRows(WITH_LUNCH));
    assert.equal(days.length, 7);
    assert.deepEqual(Object.keys(days[1]).sort(), ['closing_time', 'day_of_week', 'is_working', 'opening_time']);
    assert.deepEqual(days[0], { day_of_week: 0, is_working: false, opening_time: null, closing_time: null });
  });
});

describe('the words on the Current schedule card and in the records', () => {
  it('lists the working days', () => {
    assert.deepEqual([...workingDaySet(CAMPUS)].sort(), [1, 2, 3, 4, 5]);
    assert.deepEqual([...workingDaySet(null)], []);
  });

  it('turns a schedule into rows: one per run of days with the same hours, Monday first, in 12-hour time', () => {
    assert.deepEqual(scheduleRows(CAMPUS), [{ days: 'Mon-Fri', hours: '8:00 AM to 5:00 PM', lunch: null }]);
    const mondayLate = [item(0, false), item(1, true, '10:00', '17:00'), ...[2, 3, 4, 5].map((d) => item(d, true, '08:00', '17:00')), item(6, false)];
    assert.deepEqual(scheduleRows(mondayLate), [
      { days: 'Mon', hours: '10:00 AM to 5:00 PM', lunch: null },
      { days: 'Tue-Fri', hours: '8:00 AM to 5:00 PM', lunch: null },
    ]);
  });

  it('a row carries its lunch, and days with and without lunch are separate rows', () => {
    assert.deepEqual(scheduleRows(WITH_LUNCH), [
      { days: 'Mon-Fri', hours: '8:00 AM to 5:00 PM', lunch: 'Lunch 12:00 PM to 1:00 PM' },
      { days: 'Sat', hours: '8:00 AM to 12:00 PM', lunch: null },
    ]);
  });

  it('days that are not next to each other are not joined, a lone day is not a range, and Sunday comes last', () => {
    const split = [item(0, true, '09:00', '12:00'), item(1, true, '08:00', '17:00'), item(2, false), item(3, true, '08:00', '17:00'), item(4, false), item(5, false), item(6, false)];
    assert.deepEqual(scheduleRows(split).map((r) => r.days), ['Mon', 'Wed', 'Sun']);
  });

  it('no working day is one row that says so', () => {
    assert.deepEqual(scheduleRows([item(0, false)]), [{ days: '', hours: 'No working days', lunch: null }]);
    assert.deepEqual(scheduleRows(null), [{ days: '', hours: 'No working days', lunch: null }]);
  });

  it('says above the rows that an office with no schedule of its own follows the campus', () => {
    assert.equal(FOLLOWS_CAMPUS_NOTE, 'No schedule set for this office yet. It follows the campus schedule:');
    assert.match(page, /const follows = scope !== CAMPUS_SCOPE && view\.usesCampus;/);
    assert.match(page, /\{follows \? <p className="text-sm text-slate-600">\{FOLLOWS_CAMPUS_NOTE\}<\/p> : null\}/);
  });

  it('a campus record is a saved version, the newest marked Current; an office record can be removed', () => {
    const entry = { audit_id: 'a-1', version_no: 3, occurred_at: '2026-11-06T02:00:00Z', items: CAMPUS };
    assert.deepEqual(campusRecord(entry, { newest: true }), { id: 'a-1', title: 'Weekly schedule · version 3', added: '11/06/2026 10:00 AM', items: CAMPUS, badge: 'Current', removable: false });
    assert.equal(campusRecord(entry).badge, 'Weekly');
    const own = officeRecord({ officeName: 'Registrar', version: 2, items: WITH_LUNCH });
    assert.deepEqual([own.title, own.added, own.badge, own.removable], ['Registrar weekly schedule', 'Version 2', 'Office schedule', true]);
  });
});
