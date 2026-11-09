import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

// The working-hours form is the "Add working hours" modal (WorkingHoursModal.js). It still asks before it saves and publishes.
describe('Working hours asks before it saves and publishes (source checks, not a browser)', () => {
  const page = read('src/app/calendar/WorkingHoursModal.js');
  it('Save & publish only checks the form and opens the confirmation; nothing is sent from the form submit', () => {
    const ask = page.slice(page.indexOf('  function askToSave(event)'), page.indexOf('  function failed(err)'));
    assert.ok(ask.includes('setConfirmOpen(true)'));
    assert.ok(!/saveCampusSchedule|saveOfficeSchedule|apiFetch/.test(ask), 'the form submit sends no request');
    assert.ok(page.includes('<form id="working-hours-form" onSubmit={askToSave}'));
    assert.ok(page.includes('type="submit" form="working-hours-form"'));
  });
  it('the schedule is sent once, only from the confirm handler, with the same campus request as before', () => {
    const confirm = page.slice(page.indexOf('  const confirmSave'), page.indexOf('\n  return (\n    <>'));
    assert.equal([...page.matchAll(/saveCampusSchedule\(/g)].length, 1);
    assert.equal([...page.matchAll(/saveOfficeSchedule\(/g)].length, 1);
    assert.ok(confirm.includes('saveCampusSchedule(toCampusDays(rows))'));
    assert.ok(confirm.includes('useSingleSubmit') || page.includes('const run = useSingleSubmit()'), 'a second click cannot send it twice');
    assert.ok(confirm.includes('setConfirmOpen(false);'));
    assert.match(read('src/lib/api/office-schedule.js'), /fetcher\(CAMPUS_SCHEDULE_API, \{ method: 'PUT', body: \{ days \} \}\)/);
    assert.equal(read('src/lib/api/office-schedule.js').includes("CAMPUS_SCHEDULE_API = '/api/calendar/schedule'"), true);
  });
  it('uses the shared confirmation dialog: Cancel is the safe default and closes it without saving', () => {
    assert.ok(page.includes("import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js'"));
    assert.ok(page.includes('title="Save and publish working hours?"'));
    assert.ok(page.includes('confirmLabel="Save & publish"'));
    assert.ok(page.includes('onConfirm={confirmSave}'));
    assert.ok(page.includes('onCancel={() => setConfirmOpen(false)}'));
  });
  it('the success message, the saved records and the read-only view are kept', () => {
    assert.ok(page.includes("notify.success('Working hours saved and published.')"));
    assert.ok(page.includes('setSaveError(failure.message)'));
    const scope = read('src/app/calendar/WorkingHoursScope.js');
    assert.ok(scope.includes('getCampusHistory'), 'the saved versions of the campus schedule are still listed (as records)');
    assert.ok(scope.includes('const mayEdit = canWrite && canEditOfficeSchedule(user.role);'));
    assert.ok(scope.includes('{mayEdit ? ('), 'only a Super Admin gets the Add button');
  });
});
