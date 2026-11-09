// CC048: per-office working days and hours with a lunch break, frontend side. Logic is tested directly and the API client against a fake
// fetcher; the screens are checked from source (there is no browser here; the real screens were also driven in a browser, see the report).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES, ROLE_LIST } from 'ccms-shared/roles';
import { getCampusSchedule, getOfficeSchedule, officeScheduleUrl, resetOfficeSchedule, saveOfficeSchedule } from '../../src/lib/api/office-schedule.js';
import {
  CAMPUS_SCOPE,
  DEFAULT_LUNCH_END,
  DEFAULT_LUNCH_START,
  MSG,
  canEditOfficeSchedule,
  canViewOfficeSchedule,
  describeDay,
  errorKey,
  isVersionConflict,
  saveFailure,
  scopeOptions,
  time12,
  toDays,
  toRows,
  toggleLunch,
  toggleWorking,
  validateRows,
} from '../../src/lib/ui/office-schedule.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const editor = [read('src/app/calendar/WorkingHoursModal.js'), read('src/app/calendar/ScheduleDayRow.js'), read('src/app/calendar/WorkingHoursScope.js')].join('\n');

const item = (dow, working, open = null, close = null, lunch = null) => ({
  day_of_week: dow,
  is_working: working,
  opening_time: working ? open : null,
  closing_time: working ? close : null,
  closes_for_lunch: Boolean(lunch),
  lunch_start: lunch ? lunch[0] : null,
  lunch_end: lunch ? lunch[1] : null,
});
// The API's order: Sunday first.
const WEEK = [item(0, false), item(1, true, '08:00', '17:00'), item(2, true, '08:00', '17:00', ['12:00', '13:00']), item(3, true, '08:00', '17:00'), item(4, true, '08:00', '17:00'), item(5, true, '08:00', '17:00'), item(6, true, '08:00', '12:00')];
const OFFICES = [
  { office_id: 'o-1', office_code: 'REG', office_name: 'Registrar' },
  { office_id: 'o-2', office_code: 'LIB', office_name: 'Library' },
];
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });

describe('the Campus / office selector', () => {
  it('Super Admin and Executive can choose the Campus or any office', () => {
    for (const role of [ROLES.SUPER_ADMIN, ROLES.EXECUTIVE]) {
      const options = scopeOptions({ role }, OFFICES);
      assert.deepEqual(options.map((o) => o.value), [CAMPUS_SCOPE, 'o-1', 'o-2'], role);
      assert.equal(options[0].label, 'Campus');
      assert.equal(options[1].label, 'REG - Registrar');
    }
  });

  it('an Office Head is offered the Campus and only their own office', () => {
    assert.deepEqual(scopeOptions({ role: ROLES.OFFICE_HEAD, officeId: 'o-2' }, OFFICES).map((o) => o.value), [CAMPUS_SCOPE, 'o-2']);
    assert.deepEqual(scopeOptions({ role: ROLES.OFFICE_HEAD, officeId: 'nobody' }, OFFICES).map((o) => o.value), [CAMPUS_SCOPE]);
  });

  it('Office Staff, and any role Core would refuse, are offered the Campus only', () => {
    for (const role of ROLE_LIST.filter((r) => ![ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.OFFICE_HEAD].includes(r))) {
      assert.deepEqual(scopeOptions({ role }, OFFICES).map((o) => o.value), [CAMPUS_SCOPE], role);
    }
    assert.deepEqual(scopeOptions(null, OFFICES).map((o) => o.value), [CAMPUS_SCOPE]);
  });

});

describe('who can edit', () => {
  it('only a Super Admin may edit; Super Admin, Executive and Office Head may view', () => {
    for (const role of ROLE_LIST) {
      assert.equal(canEditOfficeSchedule(role), role === ROLES.SUPER_ADMIN, role);
      assert.equal(canViewOfficeSchedule(role), [ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.OFFICE_HEAD].includes(role), role);
    }
  });

});

describe('the weekly editor', () => {
  it('turning a day on gives it hours, turning it off clears them and its lunch', () => {
    const off = toRows([item(6, false)])[0];
    const on = toggleWorking(off);
    assert.deepEqual([on.is_working, on.opening_time, on.closing_time, on.closes_for_lunch], [true, '08:00', '17:00', false]);
    assert.deepEqual([toggleWorking(on, { opening_time: '09:00', closing_time: '12:00' }).is_working], [false]);
    assert.equal(toggleWorking(off, { opening_time: '09:00', closing_time: '12:00' }).opening_time, '09:00');
    const lunch = toggleLunch(on);
    const cleared = toggleWorking(lunch);
    assert.deepEqual([cleared.is_working, cleared.opening_time, cleared.closes_for_lunch, cleared.lunch_start, cleared.lunch_end], [false, '', false, '', '']);
  });

  it('the lunch switch turns lunch on from 12:00 PM to 1:00 PM, and its two inputs are disabled while it is off', () => {
    const on = toggleLunch(toggleWorking(toRows([item(6, false)])[0]));
    assert.deepEqual([on.closes_for_lunch, on.lunch_start, on.lunch_end], [true, DEFAULT_LUNCH_START, DEFAULT_LUNCH_END]);
    const offAgain = toggleLunch(on);
    assert.equal(offAgain.closes_for_lunch, false);
    assert.equal(offAgain.lunch_start, '12:00', 'the times typed are kept for if it is turned on again');
    assert.match(editor, /id=\{`\$\{id\}-lunch-start`\}[^>]*disabled=\{disabled \|\| !row\.closes_for_lunch\}/);
    assert.match(editor, /id=\{`\$\{id\}-lunch-end`\}[^>]*disabled=\{disabled \|\| !row\.closes_for_lunch\}/);
  });

  it('a day that is closed has no lunch; a day whose hours do not hold 12 to 1 starts lunch empty instead of invalid', () => {
    const closed = toRows([item(0, false)])[0];
    assert.equal(toggleLunch(closed), closed);
    const morning = { ...toRows([item(6, true, '08:00', '11:00')])[0] };
    const withLunch = toggleLunch(morning);
    assert.deepEqual([withLunch.closes_for_lunch, withLunch.lunch_start, withLunch.lunch_end], [true, '', '']);
  });
});

describe('time display: 12-hour on screen, 24-hour HH:MM to and from the API', () => {
  it('shows 8:00 AM, 12:00 PM, 1:00 PM and 5:00 PM', () => {
    assert.deepEqual(['08:00', '12:00', '13:00', '17:00', '00:00', '23:59'].map(time12), ['8:00 AM', '12:00 PM', '1:00 PM', '5:00 PM', '12:00 AM', '11:59 PM']);
    for (const bad of ['', null, undefined, '8am', '25:00']) assert.equal(time12(bad), '', String(bad));
  });

  it('every time field shows its 12-hour text under the input', () => {
    assert.match(editor, /data-testid=\{`\$\{id\}-12h`\}>\{time12\(value\) \|\| ' '\}/);
  });

  it('describes a day in words: hours, lunch, and Closed', () => {
    assert.deepEqual(describeDay(WEEK[2]), { hours: '8:00 AM to 5:00 PM', lunch: 'Lunch 12:00 PM to 1:00 PM' });
    assert.deepEqual(describeDay(WEEK[6]), { hours: '8:00 AM to 12:00 PM', lunch: null });
    assert.deepEqual(describeDay(WEEK[0]), { hours: 'Closed', lunch: null });
  });

  it('what is sent is the same 24-hour text the API gave, unchanged; lunch times only while lunch is on; nothing for a closed day', () => {
    const days = toDays(toRows(WEEK));
    assert.deepEqual(days, WEEK);
    const noLunch = toDays(toRows(WEEK).map((r) => (r.day_of_week === 2 ? { ...r, closes_for_lunch: false } : r)));
    assert.deepEqual(noLunch[2], item(2, true, '08:00', '17:00'));
    assert.equal(JSON.stringify(days).includes('PM'), false, 'no 12-hour text ever goes to the API');
    assert.deepEqual(toDays([{ ...toRows(WEEK)[2], opening_time: ' 08:00 ' }])[0].opening_time, '08:00', 'trimmed');
  });
});

describe('"Use the campus schedule"', () => {
});

describe('validation: nothing invalid is sent, and each message sits under its field', () => {
  const rowsWith = (dow, patch) => toRows(WEEK).map((r) => (r.day_of_week === dow ? { ...r, ...patch } : r));

  it('a valid schedule has no problems', () => assert.deepEqual(validateRows(toRows(WEEK)), {}));

  it('closing before or at opening names the closing time of that day', () => {
    assert.deepEqual(validateRows(rowsWith(3, { opening_time: '17:00', closing_time: '08:00' })), { [errorKey(3, 'closing_time')]: MSG.CLOSING_AFTER_OPENING });
    assert.deepEqual(Object.keys(validateRows(rowsWith(3, { opening_time: '09:00', closing_time: '09:00' }))), ['days[3].closing_time']);
  });

  it('missing times on a working day are named', () => {
    const errors = validateRows(rowsWith(4, { opening_time: '', closing_time: '' }));
    assert.deepEqual(Object.keys(errors).sort(), ['days[4].closing_time', 'days[4].opening_time']);
  });

  it('lunch outside the opening hours, ending before it starts, or missing is named on the lunch field', () => {
    assert.equal(validateRows(rowsWith(2, { lunch_start: '07:00', lunch_end: '08:30' }))['days[2].lunch_start'], MSG.LUNCH_START_INSIDE);
    assert.equal(validateRows(rowsWith(2, { lunch_start: '16:00', lunch_end: '18:00' }))['days[2].lunch_end'], MSG.LUNCH_END_INSIDE);
    assert.equal(validateRows(rowsWith(2, { lunch_start: '13:00', lunch_end: '12:00' }))['days[2].lunch_end'], MSG.LUNCH_END_AFTER_START);
    assert.equal(validateRows(rowsWith(2, { lunch_start: '', lunch_end: '' }))['days[2].lunch_start'], MSG.LUNCH_START_REQUIRED);
    assert.deepEqual(validateRows(rowsWith(2, { closes_for_lunch: false, lunch_start: '07:00', lunch_end: '06:00' })), {}, 'lunch times are not checked while lunch is off');
  });

  it('all seven days closed is refused', () => {
    assert.deepEqual(validateRows(toRows(WEEK).map((r) => ({ ...r, is_working: false, closes_for_lunch: false }))), { days: 'At least one working day is required' });
  });

  it('every problem is found at once', () => {
    const errors = validateRows(rowsWith(1, { closing_time: '07:00' }).map((r) => (r.day_of_week === 2 ? { ...r, lunch_end: '11:00' } : r)));
    assert.deepEqual(Object.keys(errors).sort(), ['days[1].closing_time', 'days[2].lunch_end']);
  });

  it('Core\'s own field messages come back under the same keys', () => {
    const failure = saveFailure(apiError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { 'days[2].closing_time': 'Closing time must be after opening time', version: 'The schedule version is required' }));
    assert.equal(failure.kind, 'invalid');
    assert.deepEqual(failure.fieldErrors, { 'days[2].closing_time': 'Closing time must be after opening time' });
    assert.equal(failure.message, 'The schedule version is required');
    assert.match(editor, /setErrors\(failure\.fieldErrors\)/);
  });
});

describe('409: someone else saved first', () => {
  const conflict = apiError(409, 'OFFICE_SCHEDULE_VERSION_CONFLICT', 'changed', { current_version: 5 });

  it('is recognised and says the schedule was changed and nothing was saved', () => {
    assert.equal(isVersionConflict(conflict), true);
    assert.equal(isVersionConflict(apiError(400, 'X')), false);
    const failure = saveFailure(conflict);
    assert.deepEqual([failure.kind, failure.currentVersion], ['conflict', 5]);
    assert.match(failure.message, /changed by someone else/);
    assert.match(failure.message, /your edits have not been saved/);
  });

  it('403 and other failures have their own plain messages', () => {
    assert.equal(saveFailure(apiError(403, 'FORBIDDEN')).message, 'Only a Super Admin can change an office schedule.');
    assert.equal(saveFailure(apiError(500, 'INTERNAL_ERROR', 'Something went wrong')).kind, 'error');
  });
});

describe('the API client', () => {
  const calls = [];
  const fake = (answer = { items: [] }) => async (path, options = {}) => (calls.push({ path, ...options }), answer);

  it('reads an office\'s schedule and the campus schedule through the gateway\'s calendar address', async () => {
    calls.length = 0;
    await getOfficeSchedule('o-1', fake());
    await getCampusSchedule(fake());
    assert.deepEqual(calls.map((c) => [c.path, c.method]), [['/api/calendar/offices/o-1/schedule', undefined], ['/api/calendar/schedule', undefined]]);
    assert.equal(officeScheduleUrl('a b'), '/api/calendar/offices/a%20b/schedule');
  });

  it('saves with the version and the seven days (PUT), and resets with the version in the query (DELETE)', async () => {
    calls.length = 0;
    await saveOfficeSchedule('o-1', { version: 3, days: toDays(toRows(WEEK)) }, fake());
    await resetOfficeSchedule('o-1', 4, fake());
    assert.deepEqual([calls[0].method, calls[0].body.version, calls[0].body.days.length], ['PUT', 3, 7]);
    assert.deepEqual([calls[1].method, calls[1].path], ['DELETE', '/api/calendar/offices/o-1/schedule?version=4']);
  });

  it('uses only the calendar address, never a service address, and sends nothing to FMS or SCMS (the browser only talks to the gateway)', () => {
    const client = read('src/lib/api/office-schedule.js');
    assert.doesNotMatch(client, /https?:\/\/|localhost|127\.0\.0\.1|FMS|SCMS|sync/i);
    assert.match(client, /\/api\/calendar\//);
  });
});

describe('loading, saving and feedback states', () => {
});
