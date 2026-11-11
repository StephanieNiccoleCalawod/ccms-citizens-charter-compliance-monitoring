// The "Connected systems" panel: one card per system with a status badge and a plain sentence, and a closed "Sync activity" list.
// Logic is tested directly; the screen is checked from source (the real panel was also looked at in a browser, see the report).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ACCENTS, TONES, eventCount, fmsCard, smsCard, systemCards } from '../../src/lib/ui/sync-status.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const panel = read('src/app/calendar/SyncPanel.js');

describe('the Syllabus Management System (SMS) card', () => {
  it('"Not synced yet" (amber) with the plain sentence when it has never received data', () => {
    const card = smsCard({ sms_last_received: null, audit_last_synced: null, fms_last_push: null });
    assert.deepEqual([card.title, card.short, card.badge, card.tone], ['Syllabus Management System', 'SMS', 'Not synced yet', 'waiting']);
    assert.equal(card.text, 'Hasn\'t received any data yet. It will get the calendar on the next send.');
  });

  it('"Synced" (green) with when it last received data, in the app\'s date format and Manila time', () => {
    const card = smsCard({ sms_last_received: '2026-11-09T14:08:00Z' });
    assert.deepEqual([card.badge, card.tone], ['Synced', 'good']);
    assert.equal(card.text, 'Last received data: 11/09/2026 10:08 PM (Asia/Manila).');
    assert.equal(smsCard({ audit_last_synced: '2026-11-09T14:08:00Z' }).badge, 'Synced', 'the older field name still works');
  });

  it('a refused key or a failed send is "Key refused" / "Failed" (red) with the fixed notice text, and nothing from the service', () => {
    const refused = smsCard({ sms_issue: { state: 'KEY_REJECTED', message: 'secret detail' } });
    assert.deepEqual([refused.badge, refused.tone, refused.testId, refused.noticeState], ['Key refused', 'bad', 'sms-notice', 'KEY_REJECTED']);
    assert.match(refused.text, /refused the key/);
    assert.doesNotMatch(refused.text, /secret detail|audit/i);
    const failed = smsCard({ sms_issue: { state: 'FAILED' }, sms_last_received: '2026-11-09T14:08:00Z' });
    assert.deepEqual([failed.badge, failed.tone], ['Failed', 'bad']);
    assert.match(failed.text, /retried automatically/);
  });
});

describe('the Faculty Management System (FMS) card', () => {
  it('shows a rejected key separately and never promises automatic retry', () => {
    const card = fmsCard({ fms_last_push: { status: 'FAILED', error_code: 'KEY_REJECTED', at: '2026-11-09T14:08:00Z', message: 'private receiver detail' } });
    assert.deepEqual([card.badge, card.tone, card.noticeState], ['Key refused', 'bad', 'KEY_REJECTED']);
    assert.doesNotMatch(card.text, /retry automatically|private receiver detail/);
  });
  it('"Not synced yet" when nothing was ever sent, and no "last sent" line', () => {
    const card = fmsCard({ fms_last_push: null });
    assert.deepEqual([card.title, card.short, card.badge, card.tone, card.lastSent], ['Faculty Management System', 'FMS', 'Not synced yet', 'waiting', null]);
  });

  it('"Failed" (red) says it will retry and the changes are saved, and shows when it was last sent', () => {
    const card = fmsCard({ fms_last_push: { status: 'FAILED', at: '2026-11-09T14:08:00Z' } });
    assert.deepEqual([card.badge, card.tone], ['Failed', 'bad']);
    assert.equal(card.text, 'The last send failed. It will retry automatically, and your changes are saved.');
    assert.equal(card.lastSent, 'Last sent 11/09/2026 10:08 PM (Asia/Manila)');
  });

  it('"Synced" for a send that went through (sent or acknowledged), "Pending" while one waits', () => {
    for (const status of ['SENT', 'ACKNOWLEDGED']) assert.deepEqual([fmsCard({ fms_last_push: { status, at: '2026-11-09T14:08:00Z' } }).badge, fmsCard({ fms_last_push: { status, at: '2026-11-09T14:08:00Z' } }).tone], ['Synced', 'good']);
    const waiting = fmsCard({ fms_last_push: { status: 'PENDING', at: '2026-11-09T14:08:00Z' } });
    assert.deepEqual([waiting.badge, waiting.tone], ['Pending', 'waiting']);
  });

  it('the page keeps the two test ids it always had', () => {
    assert.equal(fmsCard({}).testId, 'fms-push');
    assert.equal(smsCard({}).testId, 'audit-sync');
  });
});

describe('the panel', () => {
  it('shows both cards, SMS first, with a heading, the sentence under it, and Refresh', () => {
    assert.deepEqual(systemCards({}).map((c) => c.id), ['sms', 'fms']);
    assert.match(panel, /Connected systems/);
    assert.match(panel, /These are separate systems\. CCCMS sends them the campus calendar\./);
    assert.match(panel, /onClick=\{load\}>\s*Refresh/);
    assert.match(panel, /\{cards\.map\(\(card\) => \(\s*<SystemCard key=\{card\.id\} card=\{card\} \/>/);
    assert.match(panel, /grid items-stretch gap-3 lg:grid-cols-2" data-testid="system-columns"/, 'the two system cards sit side by side from lg');
  });

  it('each card has a white background with a border, a coloured left edge, a name with the short name lighter, and a status badge with a word', () => {
    assert.match(panel, /const CARD = 'rounded-2xl border border-slate-200 bg-white'/);
    assert.match(panel, /border-l-4 px-5 py-4 \$\{ACCENTS\[card\.tone\]\}/);
    assert.match(panel, /\{card\.title\} <span className="font-normal text-slate-500">\(\{card\.short\}\)<\/span>/);
    assert.match(panel, /TONES\[card\.tone\]\}`\} data-testid=\{`badge-\$\{card\.id\}`\}>\{card\.badge\}/);
    assert.ok(ACCENTS.bad.includes('red') && ACCENTS.good.includes('emerald'));
    assert.ok(TONES.bad.includes('red') && TONES.waiting.includes('amber') && TONES.good.includes('emerald'));
    assert.doesNotMatch(panel, /className="card\b/);
  });

  it('a failure reads as an alert, so it is announced', () => {
    assert.match(panel, /\{\.\.\.\(card\.noticeState \? \{ role: 'alert', 'data-state': card\.noticeState \} : \{\}\)\}/);
  });

  it('"Sync activity" is closed to start with, shows how many events, and Show / Hide opens and closes the same table as before', () => {
    assert.equal(eventCount([1, 2, 3, 4, 5, 6, 7, 8]), '8 events');
    assert.equal(eventCount([1]), '1 event');
    assert.equal(eventCount([]), '0 events');
    assert.equal(eventCount(undefined), '0 events');
    assert.match(panel, /useState\(false\); \/\/ the Sync activity list is closed/);
    assert.match(panel, /aria-expanded=\{open\} aria-controls="sync-activity-list"/);
    assert.match(panel, /\{open \? 'Hide' : 'Show'\}/);
    assert.match(panel, /\{open \? \(\s*<div id="sync-activity-list"/);
    for (const heading of ['External system', 'Event', 'Status', 'Last synced', 'Attempts']) assert.ok(panel.includes(`>${heading}</Th>`), heading);
    assert.match(panel, /No changes have been shared yet\./);
  });

  it('keeps loading and error states, and shows the failed rows of the activity in red', () => {
    assert.match(panel, /Loading connected systems…/);
    assert.match(panel, /<ErrorBanner message=\{state\.error\}/);
    assert.match(panel, /row\.status === 'FAILED' \? 'bg-red-50' : ''/);
  });

  it('there is no Retry now: the browser has no way to ask for a resend (the sync job is for the scheduler only), so none is shown', () => {
    assert.doesNotMatch(panel, /Retry now/);
  });
});
