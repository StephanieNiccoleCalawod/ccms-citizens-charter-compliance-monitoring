// S8-43 / CC048 (FE part): the lunch setting means "our office stops serving the public at this time".
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { LUNCH_COPY, errorKey, lunchConfirmation, toRows, validateRows } from '../../src/lib/ui/office-schedule.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const day = (dow, extra = {}) => ({ day_of_week: dow, is_working: true, opening_time: '08:00', closing_time: '17:00', closes_for_lunch: false, lunch_start: null, lunch_end: null, ...extra });
const off = (dow) => ({ day_of_week: dow, is_working: false, opening_time: null, closing_time: null, closes_for_lunch: false, lunch_start: null, lunch_end: null });
const week = (lunch, { onlyMonTue = false } = {}) => toRows([0, 1, 2, 3, 4, 5, 6].map((dow) => (dow === 0 || dow === 6 ? off(dow) : onlyMonTue && dow > 2 ? day(dow) : day(dow, lunch(dow)))));

describe('the words (AC1)', () => {
  it('say that frontline service stops, and that an office serving at noon leaves it off', () => {
    assert.equal(LUNCH_COPY.helper, 'Frontline service stops during this break.');
    assert.match(LUNCH_COPY.noonCoverage, /keeps serving the public at noon, even with staff taking turns, leave this off/);
    assert.match(LUNCH_COPY.noonCoverage, /noon minutes then count as processing time/);
    assert.match(LUNCH_COPY.noonCoverage, /staff meal break alone is not a reason to turn it on/);
  });

  it('the toggle keeps its name and is tied to the explanation, in the shared view and in the day-by-day view; the campus has none', () => {
    const modal = read('src/app/calendar/WorkingHoursModal.js');
    assert.match(modal, /aria-label="Closes for lunch" aria-describedby="lunch-help"/);
    assert.match(modal, /id="lunch-help"[^>]*data-testid="lunch-help"/);
    assert.match(modal, /\{custom && !isCampus \? <p[^>]*data-testid="lunch-help-days"/);
    assert.match(modal, /\{!isCampus \? \(/);
  });
});

describe('the confirmation says what happens to the break (AC1)', () => {
  const lunch = () => ({ closes_for_lunch: true, lunch_start: '12:00', lunch_end: '13:00' });

  it('a break on every working day is left out of processing time, named with its times', () => {
    assert.equal(lunchConfirmation(week(lunch), false), 'The lunch break (12:00 PM to 1:00 PM) is not counted as processing time, because the office does not serve the public during it.');
  });

  it('no break: the noon hours count as processing time', () => {
    assert.equal(lunchConfirmation(week(() => ({})), false), 'No lunch break is set, so the noon hours count as processing time.');
  });

  it('a break only on some days says so; different times on different days are not summarised as one', () => {
    const some = week((dow) => (dow <= 2 ? lunch() : {}), { onlyMonTue: true });
    assert.match(lunchConfirmation(some, false), /\(12:00 PM to 1:00 PM\) on the days it is set is not counted/);
    const mixed = week((dow) => ({ closes_for_lunch: true, lunch_start: dow === 1 ? '11:30' : '12:00', lunch_end: dow === 1 ? '12:30' : '13:00' }));
    assert.match(lunchConfirmation(mixed, false), /The lunch breaks set above are not counted as processing time/);
  });

  it('says nothing for the campus (it has no lunch break) or when there is no working day', () => {
    assert.equal(lunchConfirmation(week(lunch), true), '');
    assert.equal(lunchConfirmation(toRows([0, 1, 2, 3, 4, 5, 6].map(off)), false), '');
    assert.equal(lunchConfirmation(undefined, false), '');
  });

  it('is part of the "Save and publish" question, after the existing sentences (results already computed are not changed)', () => {
    const modal = read('src/app/calendar/WorkingHoursModal.js');
    assert.match(modal, /Results already computed are not affected; only computations made afterwards follow the new schedule\. Times are in Asia\/Manila\.\$\{lunchConfirmation\(rows, isCampus\)/);
  });
});

describe('lunch times that cannot be saved are refused with a field message (AC2)', () => {
  const lunchAt = (start, end) => week(() => ({ closes_for_lunch: true, lunch_start: start, lunch_end: end }));
  const messages = (rows) => Object.fromEntries(Object.entries(validateRows(rows)).filter(([key]) => key.startsWith('days[1].lunch')));

  it('12:00 to 1:00 PM inside 8:00 to 5:00 is accepted', () => {
    assert.deepEqual(validateRows(lunchAt('12:00', '13:00')), {});
  });

  it('lunch before opening, at or after closing, ending after closing, or ending before it starts is refused beside the field', () => {
    assert.deepEqual(messages(lunchAt('07:00', '08:30')), { [errorKey(1, 'lunch_start')]: 'Lunch must start within the opening hours' });
    assert.equal(messages(lunchAt('17:00', '17:30'))[errorKey(1, 'lunch_start')], 'Lunch must start within the opening hours');
    assert.equal(messages(lunchAt('16:00', '18:00'))[errorKey(1, 'lunch_end')], 'Lunch must end within the opening hours');
    assert.equal(messages(lunchAt('13:00', '12:00'))[errorKey(1, 'lunch_end')], 'Lunch end must be after lunch start');
    assert.equal(messages(lunchAt('12:00', '12:00'))[errorKey(1, 'lunch_end')], 'Lunch end must be after lunch start');
  });

  it('a missing time is named, and nothing is sent', () => {
    assert.equal(messages(lunchAt('', '13:00'))[errorKey(1, 'lunch_start')], 'Lunch start is required when the office closes for lunch');
    assert.equal(messages(lunchAt('12:00', ''))[errorKey(1, 'lunch_end')], 'Lunch end is required when the office closes for lunch');
  });

  it('uses the same sentences as Core, so a message from the server and one from the form read alike', () => {
    const core = read('../core-service/src/lib/calendar/office-schedule.js');
    for (const sentence of ['Lunch start is required when the office closes for lunch', 'Lunch end is required when the office closes for lunch', 'Lunch must start within the opening hours', 'Lunch must end within the opening hours', 'Lunch end must be after lunch start']) {
      assert.ok(core.includes(sentence), sentence);
    }
  });
});
