import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  APPLIES_TO,
  CLASS_MODES,
  appliesToBody,
  appliesToErrors,
  classModeFor,
  describeEffect,
  formAppliesTo,
  matchesAppliesTo,
  settingsErrorMessage,
} from '../../src/lib/api/calendar.js';
import { CATALOGUE_SETTINGS_API } from '../../src/lib/api/catalogue.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x') => Object.assign(new Error(message), { name: 'ApiError', status, code });

describe('Applies to and Classes are: the values and their labels', () => {
  it('uses Core\'s values with the labels of the story', () => {
    assert.deepEqual(APPLIES_TO.map((a) => [a.value, a.label]), [['BOTH', 'Offices and classes'], ['CLASSES', 'Classes only'], ['WORK', 'Offices only']]);
    assert.deepEqual(CLASS_MODES.map((c) => [c.value, c.label]), [['SUSPENDED', 'No classes'], ['ONLINE', 'Online']]);
  });
  it('the effect is worded with the label first and the class mode second, and offices only has no class mode', () => {
    assert.equal(describeEffect({ applies_to: 'BOTH', class_mode: 'SUSPENDED' }), 'Offices and classes · No classes');
    assert.equal(describeEffect({ applies_to: 'BOTH', class_mode: 'ONLINE' }), 'Offices and classes · Online');
    assert.equal(describeEffect({ applies_to: 'CLASSES', class_mode: 'SUSPENDED' }), 'Classes only · No classes');
    assert.equal(describeEffect({ applies_to: 'CLASSES', class_mode: 'ONLINE' }), 'Classes only · Online');
    assert.equal(describeEffect({ applies_to: 'WORK', class_mode: null }), 'Offices only');
    assert.equal(describeEffect({}), 'Offices and classes', 'an entry without the field is BOTH, like Core\'s default');
    for (const raw of ['BOTH', 'CLASSES', 'WORK', 'SUSPENDED', 'ONLINE']) assert.notEqual(describeEffect({ applies_to: 'BOTH', class_mode: 'SUSPENDED' }), raw);
  });
});

describe('the conditional Classes are field', () => {
  it('offices only clears the class mode; the others keep a valid one and start at No classes', () => {
    assert.equal(classModeFor('WORK', 'ONLINE'), '');
    assert.equal(classModeFor('BOTH', 'ONLINE'), 'ONLINE');
    assert.equal(classModeFor('CLASSES', ''), 'SUSPENDED');
    assert.equal(classModeFor('BOTH', 'WHATEVER'), 'SUSPENDED');
  });
  it('switching WORK -> BOTH gives No classes, and BOTH(ONLINE) -> WORK -> CLASSES starts again at No classes', () => {
    const afterWork = classModeFor('WORK', 'ONLINE');
    assert.equal(afterWork, '');
    assert.equal(classModeFor('CLASSES', afterWork), 'SUSPENDED');
  });
});

describe('validation of the combinations (Core checks again)', () => {
  const valid = [['BOTH', 'SUSPENDED'], ['BOTH', 'ONLINE'], ['CLASSES', 'SUSPENDED'], ['CLASSES', 'ONLINE'], ['WORK', '']];
  const invalid = [['WORK', 'SUSPENDED', 'class_mode'], ['WORK', 'ONLINE', 'class_mode'], ['BOTH', '', 'class_mode'], ['CLASSES', 'MAYBE', 'class_mode'], ['EVERYONE', 'SUSPENDED', 'applies_to']];
  it('accepts the five valid combinations', () => {
    for (const [a, c] of valid) assert.deepEqual(appliesToErrors(true, a, c), {}, `${a}+${c}`);
  });
  it('refuses the invalid ones, with the message under the right field', () => {
    for (const [a, c, field] of invalid) assert.deepEqual(Object.keys(appliesToErrors(true, a, c)), [field], `${a}+${c}`);
  });
  it('while the setting is off nothing is checked here, because nothing is sent', () => {
    assert.deepEqual(appliesToErrors(false, 'WORK', 'ONLINE'), {});
  });
});

describe('what is sent to Core', () => {
  it('setting off: neither field (Core refuses any class_mode and anything but BOTH, and keeps BOTH)', () => {
    assert.deepEqual(appliesToBody(false, 'WORK', ''), {});
    assert.deepEqual(appliesToBody(false, 'BOTH', 'SUSPENDED'), {});
  });
  it('setting on: both fields every time, class_mode null for offices only, so an edit never falls back to a default', () => {
    assert.deepEqual(appliesToBody(true, 'BOTH', 'ONLINE'), { applies_to: 'BOTH', class_mode: 'ONLINE' });
    assert.deepEqual(appliesToBody(true, 'CLASSES', 'SUSPENDED'), { applies_to: 'CLASSES', class_mode: 'SUSPENDED' });
    assert.deepEqual(appliesToBody(true, 'WORK', ''), { applies_to: 'WORK', class_mode: null });
  });
  it('the Edit form starts from the saved values; an older entry is BOTH', () => {
    assert.deepEqual(formAppliesTo({ applies_to: 'CLASSES', class_mode: 'ONLINE' }), { applies_to: 'CLASSES', class_mode: 'ONLINE' });
    assert.deepEqual(formAppliesTo({ applies_to: 'WORK', class_mode: null }), { applies_to: 'WORK', class_mode: '' });
    assert.deepEqual(formAppliesTo({ applies_to: 'BOTH', class_mode: 'SUSPENDED' }), { applies_to: 'BOTH', class_mode: 'SUSPENDED' });
    assert.deepEqual(formAppliesTo({}), { applies_to: 'BOTH', class_mode: 'SUSPENDED' });
  });
  it('the filter keeps entries of one kind and All keeps everything', () => {
    const entries = [{ applies_to: 'BOTH' }, { applies_to: 'CLASSES' }, { applies_to: 'WORK' }, {}];
    assert.equal(entries.filter((e) => matchesAppliesTo(e, 'CLASSES')).length, 1);
    assert.equal(entries.filter((e) => matchesAppliesTo(e, 'BOTH')).length, 2);
    assert.equal(entries.filter((e) => matchesAppliesTo(e, '')).length, 4);
  });
});

describe('what a failed settings change says', () => {
  it('403 says only a Super Admin can change it, with no server detail', () => {
    assert.match(settingsErrorMessage(apiError(403, 'FORBIDDEN', 'Insufficient role at /srv/x.js')), /Only a Super Admin/);
  });
  it('Core\'s own words for the entries that block turning it off', () => {
    assert.equal(settingsErrorMessage(apiError(409, 'CALENDAR_SETTING_IN_USE', 'Existing class/work-specific entries must be reviewed before disabling this setting')), 'Existing class/work-specific entries must be reviewed before disabling this setting');
  });
  it('a server error is safe, a network error keeps its readable message', () => {
    assert.doesNotMatch(settingsErrorMessage(apiError(500, 'X', 'pg: boom')), /pg:/);
    assert.equal(settingsErrorMessage(apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server.')), 'Cannot reach the server.');
  });
});

describe('the Holidays tab and the setting panel (source checks, not a browser)', () => {
  const holidays = read('src/app/calendar/Holidays.js');
  const panel = read('src/components/calendar/AppliesToSetting.js');

  it('the setting is read from Core for every role and written with PUT { applies_to_enabled } by the Super Admin panel only', () => {
    assert.equal(CATALOGUE_SETTINGS_API, '/api/catalogue/catalogue-settings');
    assert.ok(holidays.includes('apiFetch(CATALOGUE_SETTINGS_API)'));
    assert.ok(holidays.includes('{canWrite ? <AppliesToSetting'));
    assert.ok(panel.includes("{ method: 'PUT', body: { applies_to_enabled: target } }"));
    assert.equal([...(holidays + panel).matchAll(/applies_to_enabled/g)].length >= 2, true);
    assert.ok(!/localStorage|sessionStorage/.test(holidays + panel));
  });
  it('the panel confirms before turning it on or off, shows Core\'s value after saving, and shows no success message on an error', () => {
    assert.ok(panel.includes('Turn on class and office suspensions?') && panel.includes('Turn off class and office suspensions?'));
    assert.ok(panel.includes('onSaved(saved === true)'));
    const catchAt = panel.indexOf('} catch (err) {');
    assert.ok(panel.slice(catchAt, panel.indexOf('} finally', catchAt)).includes('setError(settingsErrorMessage(err))'));
    assert.ok(!panel.slice(catchAt, panel.indexOf('} finally', catchAt)).includes('setNotice'));
    assert.ok(panel.includes('disabled={saving}') && panel.includes('Loading the setting…'));
  });
  it('the Applies to and Classes are fields only exist while the setting is on, and Classes are is hidden for offices only', () => {
    assert.ok(holidays.includes('{enabled ? (\n                  <div className="grid gap-4 sm:grid-cols-2">'));
    assert.ok(holidays.includes("{form.applies_to !== 'WORK' ? ("));
    assert.ok(holidays.includes('htmlFor="applies_to"') && holidays.includes('htmlFor="class_mode"'));
    assert.ok(holidays.includes('Classes are'));
  });
  it('the body goes through appliesToBody, create and edit use POST and PUT, and a combination that is not valid is not sent', () => {
    assert.ok(holidays.includes('...appliesToBody(enabled, form.applies_to, form.class_mode),'));
    assert.ok(holidays.includes("{ method: 'PUT', body }") && holidays.includes("{ method: 'POST', body }"));
    const save = holidays.slice(holidays.indexOf('async function save(event)'), holidays.indexOf('async function remove()'));
    assert.ok(save.indexOf('appliesToErrors(enabled') < save.indexOf('apiFetch('), 'checked before anything is sent');
    assert.ok(save.includes('if (!canWrite || saving) return;'));
  });
  it('Core\'s field errors show under Applies to and Classes are, and the values typed stay in the form', () => {
    assert.ok(holidays.includes('fieldErrors.applies_to') && holidays.includes('fieldErrors.class_mode'));
    assert.ok(holidays.includes('setFieldErrors(err.details ?? {});'));
    const save = holidays.slice(holidays.indexOf('async function save(event)'), holidays.indexOf('async function remove()'));
    assert.ok(!save.slice(save.indexOf('} catch (err) {')).includes('setForm(null)'));
  });
  it('the filter uses Core\'s own query parameter, only while the setting is on, and resets with Clear filters', () => {
    assert.ok(holidays.includes("&applies_to=${appliesFilter}"));
    assert.ok(holidays.includes("const appliesFilter = enabled ? filters.applies_to : '';"));
    assert.ok(holidays.includes('id="holiday-applies-to"'));
    assert.ok(holidays.includes('<option value="">All</option>'));
    assert.ok(holidays.includes("setFilters({ search: '', type: '', applies_to: '' })"));
    assert.ok(holidays.includes('if (request !== latestLoad.current) return;'), 'an older answer cannot replace a newer one');
  });
  it('the list, the day card and the month cells show the marker, with an accessible label', () => {
    assert.equal([...holidays.matchAll(/data-testid="entry-effect"/g)].length, 2);
    assert.ok(holidays.includes('data-testid="cell-effect"') && holidays.includes('title={a.label}'));
    assert.ok(holidays.includes('(${describeEffect(e)})'), 'the cell\'s accessible label names the effect');
    assert.ok(holidays.includes('= ${a.label}'), 'a legend explains the short marks');
  });
  it('Edit is offered to the Super Admin only, loads the saved entry, and the existing Add, Delete and search still work', () => {
    assert.ok(holidays.includes('function openEdit(entry)'));
    assert.ok(holidays.includes('...formAppliesTo(entry)'));
    assert.equal([...holidays.matchAll(/onClick=\{\(\) => openEdit\(entry\)\}/g)].length, 2);
    assert.ok(holidays.includes('canWrite ? ('));
    assert.ok(holidays.includes("{ method: 'DELETE' }") && holidays.includes('id="holiday-search"'));
  });
});
