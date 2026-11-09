// CC048: the engine with an office's own schedule and a lunch break. Pure engine tests (no database); this file is also run by
// scripts/test-engine-tz.mjs under TZ=UTC and under America/Los_Angeles, so a hidden dependency on the server clock fails here.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { computeAddedWorkingMinutes, computeDeadline, computeWorkingMinutes, createCalendar, describeDay, formatManilaIso } from '../../src/lib/calendar/engine/working-time.js';
import { CHARTER_SCHEDULE, D, DEFAULT_SCHEDULE, OFFICE_A, OFFICE_B, at, calendar, entry } from './fixtures.js';

const row = (day_of_week, is_working, opening_time = null, closing_time = null, lunch = null) => ({
  day_of_week,
  is_working,
  opening_time: is_working ? opening_time : null,
  closing_time: is_working ? closing_time : null,
  closes_for_lunch: Boolean(lunch),
  lunch_start: lunch ? lunch[0] : null,
  lunch_end: lunch ? lunch[1] : null,
});

// Mon-Fri 08:00-17:00 with lunch 12:00-13:00; Saturday 08:00-12:00 with no lunch; Sunday off.
const lunchWeek = (withLunch = true) => [
  row(0, false),
  ...[1, 2, 3, 4, 5].map((d) => row(d, true, '08:00', '17:00', withLunch ? ['12:00', '13:00'] : null)),
  row(6, true, '08:00', '12:00'),
];

const mins = (cal, startDate, startTime, endDate, endTime) => computeWorkingMinutes(cal, at(startDate, startTime), at(endDate, endTime));
// October 2026: Tue 6, Wed 7, Thu 8, Fri 9, Sat 10, Sun 11, Mon 12, Tue 13.

describe('AC3: the lunch break is not working time', () => {
  it('Tuesday 11:00 to 14:00 with lunch 12:00-13:00 is 120 minutes; without the lunch setting it is 180', () => {
    assert.equal(mins(createCalendar({ schedule: lunchWeek(true) }), D.tue, '11:00', D.tue, '14:00'), 120);
    assert.equal(mins(createCalendar({ schedule: lunchWeek(false) }), D.tue, '11:00', D.tue, '14:00'), 180);
  });

  it('a span that is only lunch is zero; a span that starts or ends inside lunch counts only the working part', () => {
    const cal = createCalendar({ schedule: lunchWeek(true) });
    assert.equal(mins(cal, D.tue, '12:10', D.tue, '12:50'), 0);
    assert.equal(mins(cal, D.tue, '11:30', D.tue, '12:30'), 30);
    assert.equal(mins(cal, D.tue, '12:30', D.tue, '13:30'), 30);
    assert.equal(mins(cal, D.tue, '08:00', D.tue, '17:00'), 480, 'a full 9-hour day minus the 60-minute lunch');
  });

  it('across days: Tuesday 16:00 to Wednesday 09:00 is 60 + 60 with lunch (nothing is cut in those hours)', () => {
    assert.equal(mins(createCalendar({ schedule: lunchWeek(true) }), D.tue, '16:00', D.wed, '09:00'), 120);
  });

  it('adding working minutes skips the lunch: 11:30 + 60 is 13:30 with lunch, 12:30 without', () => {
    const iso = (cal) => formatManilaIso(computeAddedWorkingMinutes(cal, at(D.tue, '11:30'), 60));
    assert.equal(iso(createCalendar({ schedule: lunchWeek(true) })), '2026-10-06T13:30:00+08:00');
    assert.equal(iso(createCalendar({ schedule: lunchWeek(false) })), '2026-10-06T12:30:00+08:00');
  });

  it('the day still opens at its opening time and closes at its closing time; lunch does not move the deadline day\'s closing', () => {
    const withLunch = createCalendar({ schedule: lunchWeek(true) });
    assert.deepEqual(describeDay(withLunch, D.tue), { is_working_day: true, window: { opening_time: '08:00', closing_time: '17:00' } });
    const due = computeDeadline(withLunch, { startMs: at(D.tue, '10:00'), workingDays: 1 });
    assert.equal(formatManilaIso(due), '2026-10-07T17:00:00+08:00');
  });

  it('a hold extension that crosses a lunch break skips it', () => {
    const due = computeDeadline(createCalendar({ schedule: lunchWeek(true) }), { startMs: at(D.tue, '10:00'), workingDays: 1, heldMinutes: 30 });
    assert.equal(formatManilaIso(due), '2026-10-08T08:30:00+08:00', 'Wed 17:00 + 30 working minutes = Thu 08:30');
  });

  it('only a day with the setting loses its lunch: Saturday (no lunch) counts all four hours', () => {
    assert.equal(mins(createCalendar({ schedule: lunchWeek(true) }), D.sat, '08:00', D.sat, '12:00'), 240);
  });

  it('a lunch that is not valid for its day is ignored, never a negative or missing time', () => {
    const bad = (lunch) => createCalendar({ schedule: [row(2, true, '08:00', '17:00'), { ...row(2, true, '08:00', '17:00'), closes_for_lunch: true, lunch_start: lunch[0], lunch_end: lunch[1] }].slice(1) });
    for (const lunch of [['07:00', '08:30'], ['16:00', '18:00'], ['13:00', '12:00'], ['12:00', '12:00'], [null, '13:00'], ['12:00', 'noon']]) {
      assert.equal(mins(bad(lunch), D.tue, '11:00', D.tue, '14:00'), 180, JSON.stringify(lunch));
    }
  });
});

describe('lunch with holidays and suspensions (the existing exception logic is not bypassed)', () => {
  const week = createCalendar;

  it('a whole-day holiday still wins over the office schedule', () => {
    const cal = week({ schedule: lunchWeek(true), exceptions: [entry(D.tue)] });
    assert.equal(mins(cal, D.tue, '09:00', D.tue, '16:00'), 0);
    assert.equal(describeDay(cal, D.tue).is_working_day, false);
  });

  it('a part-day suspension and the lunch are both cut out, and where they overlap nothing is counted twice', () => {
    const cal = week({ schedule: lunchWeek(true), exceptions: [entry(D.tue, { exception_type: 'SUSPENSION', suspended_from: '12:30', suspended_until: '14:00' })] });
    assert.equal(mins(cal, D.tue, '11:00', D.tue, '15:00'), 60 + 60, '11:00-12:00 and 14:00-15:00');
    const early = week({ schedule: lunchWeek(true), exceptions: [entry(D.tue, { exception_type: 'SUSPENSION', suspended_from: '09:00', suspended_until: '10:00' })] });
    assert.equal(mins(early, D.tue, '08:00', D.tue, '17:00'), 480 - 60);
  });

  it('a campus-wide entry applies to an office with its own schedule, and an entry for one office only to that office', () => {
    const holidays = [entry(D.wed, { office_id: OFFICE_A }), entry(D.thu)];
    const a = week({ schedule: lunchWeek(true), exceptions: holidays, officeId: OFFICE_A });
    const b = week({ schedule: lunchWeek(true), exceptions: holidays, officeId: OFFICE_B });
    assert.equal(describeDay(a, D.wed).is_working_day, false);
    assert.equal(describeDay(b, D.wed).is_working_day, true);
    assert.equal(describeDay(a, D.thu).is_working_day, false);
    assert.equal(describeDay(b, D.thu).is_working_day, false);
  });
});

describe('AC2: one office\'s schedule never affects another', () => {
  // Office A works Saturday 08:00-12:00; Office B follows the campus schedule, which has no Saturday.
  const officeA = createCalendar({ schedule: lunchWeek(false), officeId: OFFICE_A });
  const officeB = createCalendar({ schedule: DEFAULT_SCHEDULE, officeId: OFFICE_B });

  it('a Saturday 09:00 start is a working start for Office A only', () => {
    assert.deepEqual(describeDay(officeA, D.sat), { is_working_day: true, window: { opening_time: '08:00', closing_time: '12:00' } });
    assert.deepEqual(describeDay(officeB, D.sat), { is_working_day: false, window: null });
    assert.equal(mins(officeA, D.sat, '09:00', D.sat, '10:00'), 60);
    assert.equal(mins(officeB, D.sat, '09:00', D.sat, '10:00'), 0);
  });

  it('their deadlines differ accordingly: counting starts after a Saturday start, and only Office A counts Saturday', () => {
    const due = (cal) => formatManilaIso(computeDeadline(cal, { startMs: at(D.fri, '10:00'), workingDays: 1 }));
    assert.equal(due(officeA), '2026-10-10T12:00:00+08:00');
    assert.equal(due(officeB), '2026-10-12T17:00:00+08:00');
  });
});

describe('AC1 (engine side): a schedule without lunch fields behaves exactly as before', () => {
  const battery = (schedule) => {
    const cal = calendar([], null, schedule);
    const spans = [
      [D.tue, '10:00', D.tue, '11:30'],
      [D.tue, '18:30', D.wed, '08:30'],
      [D.fri, '18:00', D.tue2, '09:00'],
      [D.sat, '09:00', D.sat, '16:00'],
      [D.sun, '09:00', D.mon, '09:00'],
      [D.tue, '07:00', D.tue2, '23:00'],
    ];
    return {
      minutes: spans.map(([a, b, c, d]) => mins(cal, a, b, c, d)),
      deadlines: [1, 2, 5, 7].map((n) => computeDeadline(cal, { startMs: at(D.tue, '10:00'), workingDays: n, heldMinutes: n * 10 })),
      added: [0, 45, 600, 2500].map((m) => computeAddedWorkingMinutes(cal, at(D.fri, '16:30'), m)),
      days: [D.tue, D.sat, D.sun, D.mon].map((date) => describeDay(cal, date)),
    };
  };
  const stripped = (schedule) => schedule.map(({ day_of_week, is_working, opening_time, closing_time }) => ({ day_of_week, is_working, opening_time, closing_time }));
  const explicitOff = (schedule) => schedule.map((r) => ({ ...r, closes_for_lunch: false, lunch_start: null, lunch_end: null }));

  it('rows with the lunch fields switched off give the same answers as rows that never had them (campus and charter weeks)', () => {
    for (const schedule of [DEFAULT_SCHEDULE, CHARTER_SCHEDULE]) {
      assert.deepEqual(battery(explicitOff(stripped(schedule))), battery(stripped(schedule)));
    }
  });

  it('stored lunch times are ignored while the setting is off', () => {
    const kept = lunchWeek(true).map((r) => ({ ...r, closes_for_lunch: false }));
    assert.deepEqual(battery(kept), battery(lunchWeek(false)));
  });
});
