import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { describeSchedule } from '../../src/lib/api/calendar.js';
import { formatDate, formatDateTime, formatTime, formatTimeRange } from '../../src/lib/ui/date-format.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const sources = walk(join(ROOT, 'src')).filter((f) => f.endsWith('.js'));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const rel = (f) => relative(ROOT, f).replaceAll('\\', '/');

describe('formatDate: date-only values become MM/DD/YYYY', () => {
  it('formats the required example', () => assert.equal(formatDate('2026-11-10'), '11/10/2026'));

  it('keeps two-digit month and day and a four-digit year', () => {
    assert.equal(formatDate('2026-01-05'), '01/05/2026');
    assert.equal(formatDate('2026-12-31'), '12/31/2026');
    assert.equal(formatDate('0999-03-07'), '03/07/0999');
  });

  it('accepts leap days only in leap years', () => {
    assert.equal(formatDate('2028-02-29'), '02/29/2028');
    assert.equal(formatDate('2026-02-29'), '');
  });

  it('gives an empty string for missing or unreadable values, never a guess', () => {
    for (const bad of [null, undefined, '', ' ', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-5', '11/10/2026', '2026-11-10T00:00:00Z', 20261110, {}, 'abc']) {
      assert.equal(formatDate(bad), '', String(bad));
    }
  });
});

describe('formatTime: 24-hour times become h:mm AM/PM', () => {
  it('formats the required example', () => assert.equal(formatTime('13:00'), '1:00 PM'));

  it('midnight is 12:00 AM and noon is 12:00 PM', () => {
    assert.equal(formatTime('00:00'), '12:00 AM');
    assert.equal(formatTime('12:00'), '12:00 PM');
    assert.equal(formatTime('00:30'), '12:30 AM');
    assert.equal(formatTime('12:45'), '12:45 PM');
  });

  it('covers the morning and the evening', () => {
    assert.equal(formatTime('08:00'), '8:00 AM');
    assert.equal(formatTime('09:05'), '9:05 AM');
    assert.equal(formatTime('11:59'), '11:59 AM');
    assert.equal(formatTime('17:00'), '5:00 PM');
    assert.equal(formatTime('19:00'), '7:00 PM');
    assert.equal(formatTime('23:59'), '11:59 PM');
  });

  it('accepts HH:MM:SS from a time input and ignores the seconds', () => assert.equal(formatTime('13:00:00'), '1:00 PM'));

  it('gives an empty string for missing or unreadable values', () => {
    for (const bad of [null, undefined, '', '24:00', '13:60', '1:00', '13', '1pm', '13:00 PM', 1300]) assert.equal(formatTime(bad), '', String(bad));
  });

  it('a range reads "8:00 AM to 7:00 PM"', () => {
    assert.equal(formatTimeRange('08:00', '19:00'), '8:00 AM to 7:00 PM');
    assert.equal(formatTimeRange('08:00', 'x'), '');
  });
});

describe('formatDateTime: ISO date-times become MM/DD/YYYY h:mm AM/PM in Asia/Manila', () => {
  it('formats the required example (06:05 UTC is 2:05 PM in Manila)', () => assert.equal(formatDateTime('2026-11-10T06:05:00Z'), '11/10/2026 2:05 PM'));

  it('shifts by the +08:00 offset, across the date line and the year end too', () => {
    assert.equal(formatDateTime('2026-11-10T16:00:00Z'), '11/11/2026 12:00 AM'); // Manila midnight
    assert.equal(formatDateTime('2026-11-10T15:59:00Z'), '11/10/2026 11:59 PM');
    assert.equal(formatDateTime('2026-11-10T04:00:00Z'), '11/10/2026 12:00 PM'); // Manila noon
    assert.equal(formatDateTime('2026-12-31T20:00:00Z'), '01/01/2027 4:00 AM');
  });

  it('midnight is 12:00 AM and noon is 12:00 PM', () => {
    assert.equal(formatDateTime('2026-11-09T16:00:00.000Z'), '11/10/2026 12:00 AM');
    assert.equal(formatDateTime('2026-11-10T12:00:00+08:00'), '11/10/2026 12:00 PM');
    assert.equal(formatDateTime('2026-11-10T00:00:00+08:00'), '11/10/2026 12:00 AM');
  });

  it('understands any explicit offset and fractional seconds', () => {
    assert.equal(formatDateTime('2026-11-10T14:05:00+08:00'), '11/10/2026 2:05 PM');
    assert.equal(formatDateTime('2026-11-10T01:05:00-05:00'), '11/10/2026 2:05 PM');
    assert.equal(formatDateTime('2026-11-10T06:05:09.123Z'), '11/10/2026 2:05 PM');
  });

  it('refuses a date-time with no offset (it would depend on the browser clock) and other bad values', () => {
    for (const bad of [null, undefined, '', '2026-11-10T06:05:00', '2026-11-10', '2026-11-10 06:05:00Z', 'yesterday', '2026-13-10T06:05:00Z', 12345]) {
      assert.equal(formatDateTime(bad), '', String(bad));
    }
  });
});

describe('the same answers in every browser time zone', () => {
  const moduleUrl = pathToFileURL(join(ROOT, 'src/lib/ui/date-format.js')).href;
  const probe = [
    `import { formatDate, formatDateTime, formatTime } from ${JSON.stringify(moduleUrl)};`,
    'console.log(JSON.stringify([',
    "  formatDate('2026-11-10'), formatDate('2026-01-01'), formatDate('2026-12-31'),",
    "  formatDateTime('2026-11-10T06:05:00Z'), formatDateTime('2026-11-10T16:00:00Z'), formatDateTime('2026-03-08T07:00:00Z'),",
    "  formatTime('13:00'), formatTime('00:00'), formatTime('12:00'),",
    '  new Date().getTimezoneOffset(),',
    ']));',
  ].join('\n');
  const run = (tz) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));

  it('is identical in Manila, UTC, Los Angeles (daylight saving), Kiritimati (UTC+14) and Pago Pago (UTC-11)', () => {
    const zones = ['Asia/Manila', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
    const results = zones.map((tz) => ({ tz, out: run(tz) }));
    // The probe really ran in different zones...
    assert.ok(new Set(results.map((r) => r.out.at(-1))).size >= 4, JSON.stringify(results.map((r) => r.out.at(-1))));
    // ...and every answer except the zone's own offset is the same.
    const expected = ['11/10/2026', '01/01/2026', '12/31/2026', '11/10/2026 2:05 PM', '11/11/2026 12:00 AM', '03/08/2026 3:00 PM', '1:00 PM', '12:00 AM', '12:00 PM'];
    for (const { tz, out } of results) assert.deepEqual(out.slice(0, -1), expected, tz);
  });
});

describe('the working-hours description uses the same time format', () => {
  it('groups days and shows "8:00 AM to 5:00 PM"', () => {
    const day = (d, open, close) => ({ day_of_week: d, is_working: Boolean(open), opening_time: open, closing_time: close });
    const items = [day(0), day(1, '08:00', '17:00'), day(2, '08:00', '17:00'), day(3, '08:00', '17:00'), day(4, '08:00', '17:00'), day(5, '08:00', '17:00'), day(6, '08:00', '12:00')];
    assert.equal(describeSchedule(items), 'Mon-Fri 8:00 AM to 5:00 PM · Sat 8:00 AM to 12:00 PM');
    assert.equal(describeSchedule([day(2, '08:00', '19:00')]), 'Tue 8:00 AM to 7:00 PM');
    assert.equal(describeSchedule([day(0)]), 'No working days');
  });
});

describe('formatting stays at the display boundary', () => {
  it('never changes its input', () => {
    const value = '2026-11-10';
    formatDate(value);
    assert.equal(value, '2026-11-10');
  });

  it('request bodies are built from the form values, not from formatted text', () => {
    const has = (file, text) => assert.ok(read(file).includes(text), `${file} should contain: ${text}`);
    has('src/app/calendar/Holidays.js', 'exception_date: form.exception_date,');
    has('src/app/calendar/Holidays.js', 'suspended_from: time.from,');
    has('src/app/calendar/Holidays.js', 'suspended_until: time.until,');
    has('src/app/calendar/Terms.js', 'start_date: form.start_date, end_date: form.end_date');
    // The working-hours form sends the typed 24-hour text as it is (trimmed), through one helper.
    has('src/lib/ui/office-schedule.js', 'opening_time: r.opening_time.trim(),');
    has('src/lib/ui/office-schedule.js', 'closing_time: r.closing_time.trim(),');
    has('src/lib/ui/service-form.js', 'effective_from: values.effective_from,');
    // Edit forms start from the API values, untouched.
    has('src/app/calendar/Terms.js', 'start_date: term.start_date, end_date: term.end_date');
    // No formatter is called anywhere a request body is made.
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/body\s*[:=]\s*\{[^}]*\}/g)) assert.doesNotMatch(match[0], /format(Date|Time|DateTime|TimeRange)\(/, rel(file));
    }
  });
});

describe('every screen uses the shared helpers', () => {
  it('every date entry field has the MM/DD/YYYY hint, linked with aria-describedby', () => {
    const files = sources.filter((f) => /type="date"/.test(readFileSync(f, 'utf8')));
    assert.ok(files.length >= 4, files.map(rel).join(', '));
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const inputs = [...text.matchAll(/<input\b[\s\S]*?\/>/g)].filter(([input]) => /type="date"/.test(input));
      for (const [input] of inputs) assert.match(input, /aria-describedby=/, `${rel(file)}: ${input.slice(0, 60)}`);
      const dateHints = [...text.matchAll(/<DateHint /g)].length;
      if (['src/app/logs/page.js', 'src/app/transactions/page.js'].includes(rel(file))) assert.equal(dateHints, 0, `${rel(file)} uses native date fields without redundant hints`);
      else assert.equal(dateHints, inputs.length, `${rel(file)} needs one DateHint per date input`);
    }
    assert.match(read('src/components/forms/DateHint.js'), /MM\/DD\/YYYY/);
  });

  it('native date and time pickers are still native (no text inputs replacing them)', () => {
    // Every time in the working-hours form is the one native time input (a shared component), never a text box.
    assert.equal([...read('src/app/calendar/ScheduleDayRow.js').matchAll(/type="time"/g)].length, 1);
    assert.doesNotMatch(read('src/app/calendar/WorkingHoursModal.js'), /type="text"/);
    for (const file of ['src/app/calendar/Holidays.js', 'src/app/calendar/Terms.js', 'src/app/services/[id]/page.js', 'src/components/forms/ServiceForm.js']) assert.match(read(file), /type="date"/, file);
  });

  it('Calendar, sync, working hours, terms and service standards import the shared formatters', () => {
    const uses = (file, names) => {
      const text = read(file);
      assert.match(text, /from '(\.\.\/)+lib\/ui\/date-format\.js'/, file);
      for (const name of names) assert.ok(text.includes(`${name}(`), `${file} should call ${name}`);
    };
    uses('src/app/calendar/Holidays.js', ['formatDate', 'formatTime']);
    uses('src/app/calendar/Terms.js', ['formatDate']);
    uses('src/app/calendar/SyncPanel.js', ['formatDateTime']);
    assert.match(read('src/lib/ui/working-hours.js'), /from '\.\/date-format\.js'/); // the records on the Working hours tab
    assert.ok(read('src/lib/ui/working-hours.js').includes('formatDateTime('));
    uses('src/app/services/[id]/page.js', ['formatDate']);
    assert.match(read('src/lib/api/calendar.js'), /formatTimeRange/);
  });

  it('nothing else formats a date or time by hand', () => {
    for (const file of sources) {
      if (rel(file) === 'src/lib/ui/date-format.js') continue;
      assert.doesNotMatch(readFileSync(file, 'utf8'), /toLocale(Date|Time)String|Intl\.DateTimeFormat|manilaDateTime|\.slice\(0, ?16\)\.replace\('T'/, rel(file));
    }
  });

  it('no screen prints a raw API date or time as text', () => {
    // A {value} in JSX text (not in an attribute) whose name says it is a date or a time. Validation
    // messages (fieldErrors.exception_date and the like) are text from the service, not dates.
    const raw = /(?<![=\w$])\{(?![\w.]*[eE]rrors?\.)[\w.?[\]]*(?:_date|_at|effective_from|effective_to|suspended_from|opening_time|closing_time|exception_date)\}/;
    for (const file of sources) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => assert.doesNotMatch(line, raw, `${rel(file)}:${i + 1}: ${line.trim()}`));
    }
  });
});
