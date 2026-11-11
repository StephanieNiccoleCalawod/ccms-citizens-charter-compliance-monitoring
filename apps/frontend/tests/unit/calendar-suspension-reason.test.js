// CC058: reason category and optional reference for campus suspensions, frontend only. The Core calendar service does not store
// them yet (see lib/ui/suspension-reason.js), so these tests cover the screen's own behaviour and the contract it keeps.
// Logic is tested directly; the screen is checked from source (there is no browser here).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  CATEGORY_REQUIRED,
  CATEGORY_UNKNOWN,
  DEFAULT_REASON,
  NO_REFERENCE,
  REASON_CATEGORIES,
  REFERENCE_MAX,
  REFERENCE_TOO_LONG,
  hasReason,
  isReasonCategory,
  normalizeReference,
  reasonBody,
  reasonDisplay,
  reasonFormFrom,
  reasonLabel,
  reasonProblems,
  reasonStored,
  reasonSupportedBy,
  referenceCounter,
  referenceError,
  referenceLabel,
} from '../../src/lib/ui/suspension-reason.js';
import { hasChanges } from '../../src/lib/ui/dirty-registry.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const screen = read('src/app/calendar/Holidays.js');

const SUSPENSION = { exception_id: 's-1', exception_date: '2026-10-07', exception_type: 'SUSPENSION', description: 'Typhoon', suspended_from: '13:00', suspended_until: '19:00', office_id: null, is_recurring: false };
const form = (over = {}) => ({ exception_type: 'SUSPENSION', reason_category: '', reference: '', ...over });

describe('1. the category dropdown', () => {
  it('has the eight categories, in order, with the exact labels and API values', () => {
    assert.deepEqual(
      REASON_CATEGORIES.map((c) => [c.label, c.value]),
      [
        ['Typhoon / Weather', 'TYPHOON_WEATHER'],
        ['Heat Index', 'HEAT_INDEX'],
        ['Power / Water Outage', 'POWER_WATER_OUTAGE'],
        ['Earthquake / Drill', 'EARTHQUAKE_DRILL'],
        ['Security Threat', 'SECURITY_THREAT'],
        ['Holiday Proclamation', 'HOLIDAY_PROCLAMATION'],
        ['University Event', 'UNIVERSITY_EVENT'],
        ['Other', 'OTHER'],
      ],
    );
  });

  it('the form renders every category from that list, after a "Select a reason" prompt, with no value chosen for a new entry', () => {
    assert.match(screen, /<option value="">Select a reason<\/option>/);
    assert.match(screen, /\{REASON_CATEGORIES\.map\(\(c\) => \(\s*<option key=\{c\.value\} value=\{c\.value\}>\s*\{c\.label\}/);
    assert.match(screen, /reason_category: '', reference: '' \};/, 'the empty form has no category chosen');
    assert.equal(isReasonCategory('OTHER'), true);
    assert.equal(isReasonCategory('typhoon'), false);
    assert.equal(isReasonCategory(''), false);
  });

  it('shows the fields for all saved calendar entry types', () => {
    for (const type of ['SUSPENSION', 'REGULAR_HOLIDAY', 'SPECIAL_NON_WORKING', 'LOCAL_HOLIDAY']) assert.equal(hasReason(type), true);
    for (const type of ['', undefined]) assert.equal(hasReason(type), false, String(type));
    assert.match(screen, /\{hasReason\(form\.exception_type\) \? \(\s*<div className="grid gap-4 sm:grid-cols-2" data-testid="reason-fields">/);
  });
});

describe('2. a new suspension requires a category', () => {
  it('refuses a missing category with a clear message, and a value outside the list', () => {
    assert.deepEqual(reasonProblems(form()), { reason_category: CATEGORY_REQUIRED });
    assert.equal(CATEGORY_REQUIRED, 'Choose a reason category');
    assert.deepEqual(reasonProblems(form({ reason_category: 'NOT_A_REASON' })), { reason_category: CATEGORY_UNKNOWN });
    assert.deepEqual(reasonProblems(form({ reason_category: 'HEAT_INDEX' })), {});
  });

  it('a new holiday also requires a category', () => {
    assert.deepEqual(reasonProblems({ exception_type: 'REGULAR_HOLIDAY', reason_category: '', reference: '' }), { reason_category: CATEGORY_REQUIRED });
  });

  it('the save stops before sending and shows the message under the field, marked required', () => {
    assert.match(screen, /\.\.\.time\.errors, \.\.\.reasonProblems\(form\) \};/);
    assert.match(screen, /if \(Object\.keys\(problems\)\.length\) \{\s*setFieldErrors\(problems\);/);
    assert.match(screen, /Reason category<RequiredMark \/>/);
    assert.match(screen, /aria-required="true"/);
    assert.match(screen, /<FieldError id="reason_category-error">\{fieldErrors\.reason_category\}<\/FieldError>/);
    assert.match(screen, /aria-invalid=\{fieldErrors\.reason_category \? 'true' : undefined\}/);
  });
});

describe('3 to 5. the reference', () => {
  it('3. is optional: empty, blank or missing is fine and is sent as null', () => {
    for (const reference of ['', '   ', undefined, null]) {
      assert.deepEqual(reasonProblems(form({ reason_category: 'OTHER', reference })), {});
      assert.equal(reasonBody(form({ reason_category: 'OTHER', reference })).reference, null);
    }
  });

  it('4. accepts up to 100 characters, counted without the outer spaces', () => {
    assert.equal(REFERENCE_MAX, 100);
    assert.deepEqual(reasonProblems(form({ reason_category: 'OTHER', reference: 'x'.repeat(100) })), {});
    assert.deepEqual(reasonProblems(form({ reason_category: 'OTHER', reference: `  ${'x'.repeat(100)}  ` })), {});
    assert.equal(referenceCounter('  MEMO 12  '), '7/100');
    assert.equal(referenceCounter(''), '0/100');
  });

  it('5. rejects more than 100 characters, shows the message, and the counter turns red', () => {
    assert.deepEqual(reasonProblems(form({ reason_category: 'OTHER', reference: 'x'.repeat(101) })), { reference: REFERENCE_TOO_LONG });
    assert.equal(referenceError('x'.repeat(101)), 'Reference must be 100 characters or fewer');
    assert.equal(referenceCounter('x'.repeat(101)), '101/100');
    assert.match(screen, /referenceError\(form\.reference\) \? 'font-semibold text-red-700' : 'text-slate-500'/);
    assert.match(screen, /<FieldError id="reference-error">\{fieldErrors\.reference\}<\/FieldError>/);
    assert.match(screen, /data-testid="reference-counter"/);
  });

  it('is trimmed before it is sent, and the category goes out as its API value', () => {
    assert.deepEqual(reasonBody(form({ reason_category: 'TYPHOON_WEATHER', reference: '  Memo No. 2026-114  ' })), { reason_category: 'TYPHOON_WEATHER', reference: 'Memo No. 2026-114' });
    assert.equal(normalizeReference(undefined), '');
  });
});

describe('6 and 7. what is shown when a record has no category or no reference', () => {
  it('6. an entry without a category is shown as Other (a readable label, never the raw value)', () => {
    for (const value of [undefined, null, '', 'SOMETHING_ELSE']) assert.equal(reasonLabel(value), 'Other', String(value));
    assert.equal(reasonDisplay(SUSPENSION).category, 'Other');
    assert.equal(reasonLabel('TYPHOON_WEATHER'), 'Typhoon / Weather');
    assert.equal(DEFAULT_REASON, 'OTHER');
    for (const c of REASON_CATEGORIES) assert.notEqual(reasonLabel(c.value), c.value === 'OTHER' ? 'OTHER' : c.value, 'no raw enum values on screen');
  });

  it('7. a missing reference is a dash, and nothing is made up', () => {
    for (const value of [undefined, null, '', '   ']) assert.equal(referenceLabel(value), NO_REFERENCE);
    assert.equal(NO_REFERENCE, '—');
    assert.equal(reasonDisplay(SUSPENSION).reference, '—');
    assert.equal(referenceLabel(' Memo 7 '), 'Memo 7');
  });
});

describe('8. the edit form', () => {
  it('loads the saved category and reference, and keeps them when reopened', () => {
    const saved = { ...SUSPENSION, reason_category: 'POWER_WATER_OUTAGE', reference: 'Memo 2026-30' };
    assert.deepEqual(reasonFormFrom(saved), { reason_category: 'POWER_WATER_OUTAGE', reference: 'Memo 2026-30' });
    assert.deepEqual(reasonFormFrom(reasonFormFrom(saved) && saved), reasonFormFrom(saved), 'reopening gives the same values');
    assert.match(screen, /\.\.\.formAppliesTo\(entry\),\s*\.\.\.reasonFormFrom\(entry\),/);
  });

  it('historical suspensions and holidays without a category open as Other', () => {
    assert.deepEqual(reasonFormFrom(SUSPENSION), { reason_category: 'OTHER', reference: '' });
    assert.deepEqual(reasonFormFrom({ ...SUSPENSION, reason_category: 'NOT_A_REASON' }), { reason_category: 'OTHER', reference: '' });
    assert.deepEqual(reasonFormFrom({ ...SUSPENSION, exception_type: 'REGULAR_HOLIDAY' }), { reason_category: 'OTHER', reference: '' });
    assert.deepEqual(reasonFormFrom(null), { reason_category: '', reference: '' });
  });

  it('keeps the form\'s unsaved-change behaviour', () => {
    const opened = { ...SUSPENSION, ...reasonFormFrom({ ...SUSPENSION, reason_category: 'HEAT_INDEX' }) };
    assert.equal(hasChanges(opened, { ...opened }), false);
    assert.equal(hasChanges(opened, { ...opened, reason_category: 'OTHER' }), true);
    assert.equal(hasChanges(opened, { ...opened, reference: 'Memo 1' }), true);
    assert.match(screen, /const formDirty = useFormDirty\(form\);/);
    assert.match(screen, /dirty=\{formDirty\}/);
  });

  it('the service\'s own field messages show under the fields', () => {
    assert.match(screen, /\.\.\.\(hasReason\(form\?\.exception_type\) \? \['reason_category', 'reference'\] : \[\]\)/);
    assert.match(screen, /setFieldErrors\(err\.details \?\? \{\}\)/);
  });
});

describe('9. the list and the details', () => {
  it('the day card shows the reason and the reference of a saved suspension', () => {
    assert.match(screen, /data-testid="entry-reason">Reason: \{reasonDisplay\(entry\)\.category\}/);
    assert.match(screen, /data-testid="entry-reference">Reference: \{reasonDisplay\(entry\)\.reference\}/);
  });

  it('the registry list shows both on saved entries and omits them on Nager.Date references', () => {
    assert.match(screen, /\{!entry\.nager && hasReason\(entry\.exception_type\) \? \(\s*<span className="mt-0\.5 block text-xs text-slate-600" data-testid="entry-reason-line">/);
    assert.match(screen, /Reason: \{reasonDisplay\(entry\)\.category\} · Ref: \{reasonDisplay\(entry\)\.reference\}/);
    const line = (entry) => `Reason: ${reasonDisplay(entry).category} · Ref: ${reasonDisplay(entry).reference}`;
    assert.equal(line({ ...SUSPENSION, reason_category: 'TYPHOON_WEATHER', reference: 'Memo 12' }), 'Reason: Typhoon / Weather · Ref: Memo 12');
    assert.equal(line(SUSPENSION), 'Reason: Other · Ref: —');
  });
});

describe('compatibility with older Core responses', () => {
  it('knows whether the service keeps the fields from its answers', () => {
    assert.equal(reasonSupportedBy([SUSPENSION]), false);
    assert.equal(reasonSupportedBy([]), false);
    assert.equal(reasonSupportedBy(null), false);
    assert.equal(reasonSupportedBy([SUSPENSION, { ...SUSPENSION, reason_category: null }]), true, 'present even as null means the service knows the field');
    assert.equal(reasonStored({ exception: SUSPENSION }), false);
    assert.equal(reasonStored({ exception: { ...SUSPENSION, reason_category: 'OTHER', reference: null } }), true);
    assert.equal(reasonStored(null), false);
  });

  it('tells the person if an older Core response omits the saved fields', () => {
    assert.match(screen, /setReasonNotice\(hasReason\(body\.exception_type\) && !reasonStored\(answer\)\)/);
    assert.match(screen, /<StatusBanner variant="warning" message=\{REASON_NOT_STORED_NOTICE\}/);
  });
});

describe('10. existing calendar workflows are unchanged', () => {
  it('the reason helper adds metadata to holiday saves', () => {
    assert.deepEqual(reasonBody({ exception_type: 'REGULAR_HOLIDAY', reason_category: 'HOLIDAY_PROCLAMATION', reference: 'x' }),
      { reason_category: 'HOLIDAY_PROCLAMATION', reference: 'x' });
    assert.deepEqual(reasonBody({ exception_type: 'LOCAL_HOLIDAY', reason_category: 'OTHER', reference: '' }),
      { reason_category: 'OTHER', reference: null });
  });

  it('the existing request fields are all still built the same way, and the reason fields are extra ones after them', () => {
    for (const text of [
      'exception_date: form.exception_date,',
      'exception_type: form.exception_type,',
      'description: form.description.trim(),',
      'office_id: form.office_id || null,',
      'suspended_from: time.from,',
      'suspended_until: time.until,',
      "is_recurring: form.exception_type === 'SUSPENSION' ? false : form.is_recurring,",
      '...appliesToBody(enabled, form.applies_to, form.class_mode),',
    ]) {
      assert.ok(screen.includes(text), text);
    }
    assert.ok(screen.indexOf('...appliesToBody(enabled') < screen.indexOf('...reasonBody(form)'));
    assert.match(screen, /method: 'PUT', body \}\) : await apiFetch\(EXCEPTIONS_API, \{ method: 'POST', body \}\)/);
  });

  it('the dates, the working-time and applies-to validation, the success wording and the reload after a save are as before', () => {
    assert.match(screen, /const time = suspensionTimes\(form\.suspended_from, form\.suspended_until\);/);
    assert.match(screen, /\.\.\.appliesToErrors\(enabled, form\.applies_to, form\.class_mode\), \.\.\.time\.errors,/);
    assert.match(screen, /notify\.success\(savedMessage\(body\.exception_type === 'SUSPENSION' \? 'Suspension' : 'Holiday', form\.id \? 'updated' : 'created'\)\)/);
    assert.match(screen, /await load\(\);\s*onChanged\?\.\(\);/);
    assert.match(screen, /await apiFetch\(`\$\{EXCEPTIONS_API\}\/\$\{confirm\.exception_id\}`, \{ method: 'DELETE' \}\)/);
    assert.match(screen, /describeEffect\(entry\)/);
  });

  it('only the Calendar screen and the new helper changed: no calendar maths, engine, sync or API helper is touched', () => {
    const helper = read('src/lib/ui/suspension-reason.js');
    assert.doesNotMatch(helper, /^import /m, 'the helper is plain logic: it imports nothing, calls no API and does no date maths');
    assert.doesNotMatch(helper, /fetch\(|apiFetch|Date\./);
    assert.doesNotMatch(read('src/lib/api/calendar.js'), /reason_category/);
    assert.doesNotMatch(read('src/lib/ui/time-input.js'), /reason_category/);
  });

  it('the form stays responsive: the two new fields sit side by side from the sm size and stack on a phone', () => {
    assert.match(screen, /className="grid gap-4 sm:grid-cols-2" data-testid="reason-fields"/);
  });
});
