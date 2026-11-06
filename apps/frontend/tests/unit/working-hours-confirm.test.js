import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('Working hours asks before it saves and publishes (source checks, not a browser)', () => {
  const page = read('src/app/calendar/WorkingHours.js');
  it('the Save button only opens the confirmation; nothing is sent from the form submit', () => {
    const save = page.slice(page.indexOf('  function save(event)'), page.indexOf('  async function confirmSave()'));
    assert.ok(save.includes('setConfirmOpen(true)'));
    assert.ok(!save.includes('apiFetch'), 'the form submit sends no request');
    assert.ok(page.includes('<form onSubmit={save}'));
  });
  it('the schedule is sent once, only from the confirm handler, with the same request as before', () => {
    const confirm = page.slice(page.indexOf('  async function confirmSave()'), page.indexOf('const byDay'));
    assert.equal([...page.matchAll(/apiFetch\('\/api\/calendar\/schedule', \{ method: 'PUT'/g)].length, 1);
    assert.ok(confirm.includes("apiFetch('/api/calendar/schedule', { method: 'PUT', body: { days } })"));
    assert.ok(confirm.includes('if (!canWrite || saving) return;'), 'a second click cannot send it twice');
    assert.ok(confirm.includes('setConfirmOpen(false);'));
  });
  it('uses the shared confirmation dialog: Cancel is the safe default and closes it without saving', () => {
    assert.ok(page.includes("import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js'"));
    assert.ok(page.includes('title="Save and publish working hours?"'));
    assert.ok(page.includes('confirmLabel="Save & publish"'));
    assert.ok(page.includes('onConfirm={confirmSave}'));
    assert.ok(page.includes('onCancel={() => setConfirmOpen(false)}'));
  });
  it('the success and error messages, the version history and the read-only view are unchanged', () => {
    assert.ok(page.includes("setMessage('Working hours saved and published.')"));
    assert.ok(page.includes('setSaveError(err.message)'));
    assert.ok(page.includes('loadHistory();'));
    assert.ok(page.includes('The weekly schedule of the campus. Times are in Asia/Manila.'));
  });
});
