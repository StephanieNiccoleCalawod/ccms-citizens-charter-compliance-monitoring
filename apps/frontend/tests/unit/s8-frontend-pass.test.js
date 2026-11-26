// Sprint 8 front-end pass: My Account sign-in method (S8-04), NOT_INVITED (S8-45), the inactivity warning (S8-33), Security and sessions (S8-34),
// written-out dates (S8-62 helpers), the complaint tracking check (S8-56) and the overdue wording without a fake Escalate (S8-25).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLE_LIST } from 'ccms-shared/roles';
import { CLERK_PASSWORD_NOTE, formatLimit, isClerkOnly, showPasswordForm, signInMethodLabel } from '../../src/lib/ui/account.js';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import { LOGIN_NOTICES, parseLoginNotice } from '../../src/lib/auth/sign-out-flow.js';
import { WARNING_SECONDS, countdownText, idleState, readSharedActivity, shouldRenew, writeSharedActivity } from '../../src/lib/auth/idle-guard.js';
import { formatDateAxis, formatDateLong, formatDateRange, formatDateShort } from '../../src/lib/ui/date-format.js';
import { checkTrackingNumber } from '../../src/lib/api/complaints.js';
import { TRACKING_NOT_FOUND, foundLine } from '../../src/lib/ui/complaints.js';
import { deriveLateRiskItemMetrics, overdueByText } from '../../src/lib/ui/insights.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('S8-04 My Account knows how you sign in', () => {
  it('shows Password, Clerk, or both, and hides the form only for a Clerk-only account', () => {
    assert.equal(signInMethodLabel({ clerk_linked: false, has_password: true }), 'Password');
    assert.equal(signInMethodLabel({ clerk_linked: true, has_password: false }), 'PUP QC account (Clerk)');
    assert.equal(signInMethodLabel({ clerk_linked: true, has_password: true }), 'Password or PUP QC account (Clerk)');
    assert.equal(isClerkOnly({ clerk_linked: true, has_password: false }), true);
    assert.equal(showPasswordForm({ clerk_linked: true, has_password: false }), false);
    for (const unclear of [undefined, null, {}, { clerk_linked: null, has_password: false }]) assert.equal(showPasswordForm(unclear), true);
    assert.match(CLERK_PASSWORD_NOTE, /PUP QC account/);
  });
  it('the page uses them and keeps the password form for password accounts', () => {
    const page = read('src/app/account/page.js');
    assert.match(page, /showPasswordForm\(me\.sign_in\)/);
    assert.match(page, /<ChangePasswordForm \/>/);
  });
});

describe('S8-45 a Clerk user CCCMS never invited', () => {
  it('goes back to the sign-in page with a plain message, never to /access-pending', () => {
    const session = read('src/lib/auth/session.js');
    assert.match(session, /NOT_INVITED_NOTICE_URL = '\/login\?notice=not_invited'/);
    assert.match(session, /if \(rejection === NOT_INVITED\)[\s\S]*signOutOfClerk\(\)/);
    assert.ok(!/ACCESS_REJECTIONS = Object\.freeze\(\[[^\]]*NOT_INVITED/.test(session));
    assert.equal(parseLoginNotice('?notice=not_invited'), 'not_invited');
    assert.equal(LOGIN_NOTICES.not_invited, 'This sign-in is not registered for CCCMS. Ask your CCCMS administrator for an invitation.');
    assert.equal(parseLoginNotice('?notice=<script>'), null);
  });
});

describe('S8-33 inactivity warning', () => {
  const idleMinutes = 15;
  const last = 1_000_000;
  it('is active, then warns 60 seconds before the limit, then expires', () => {
    assert.equal(idleState({ now: last + 10 * 60_000, lastActivity: last, idleMinutes }).phase, 'active');
    const warning = idleState({ now: last + 14 * 60_000 + 1_000, lastActivity: last, idleMinutes });
    assert.equal(warning.phase, 'warning');
    assert.equal(warning.secondsLeft, 59);
    assert.equal(idleState({ now: last + idleMinutes * 60_000, lastActivity: last, idleMinutes }).phase, 'expired');
    assert.equal(WARNING_SECONDS, 60);
  });
  it('renews early only when the last renewal is older than a third of the limit', () => {
    assert.equal(shouldRenew({ now: 6 * 60_000, renewedAt: 0, idleMinutes: 15 }), true);
    assert.equal(shouldRenew({ now: 4 * 60_000, renewedAt: 0, idleMinutes: 15 }), false);
  });
  it('says the countdown in words and shares activity between tabs without throwing', () => {
    assert.equal(countdownText(1), '1 second');
    assert.equal(countdownText(45), '45 seconds');
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    writeSharedActivity(storage, 5000);
    assert.equal(readSharedActivity(storage, 1000), 5000);
    assert.equal(readSharedActivity({ getItem() { throw new Error('blocked'); } }, 7), 7);
    assert.doesNotThrow(() => writeSharedActivity({ setItem() { throw new Error('blocked'); } }, 1));
  });
  it('the dialog is an alert dialog with no Escape-to-dismiss, and polling never renews while limits are on', () => {
    const guard = read('src/components/auth/SessionGuard.js');
    assert.match(guard, /role="alertdialog"/);
    assert.ok(!/onClose=/.test(guard));
    assert.match(read('src/lib/auth/session.js'), /background && sessionLimitsOn/);
    assert.match(read('src/lib/api/notifications.js'), /background: true/);
    assert.match(read('src/components/layout/AppShell.js'), /<SessionGuard \/>/);
  });
});

describe('S8-34 Security and sessions', () => {
  it('is reached only through the Account Settings sidebar (not the main sidebar), and is a read-only page', () => {
    for (const role of ROLE_LIST) assert.ok(!appNavForRole(role).some((i) => i.href === '/settings/security'), role);
    const page = read('src/app/settings/security/page.js');
    assert.match(page, /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/);
    assert.ok(!/<input|<select|method: 'PUT'/.test(page));
  });
  it('writes limits as people read them', () => {
    assert.equal(formatLimit(15), '15 minutes');
    assert.equal(formatLimit(240), '4 hours');
    assert.equal(formatLimit(90), '1 hour 30 minutes');
    assert.equal(formatLimit(1), '1 minute');
  });
});

describe('S8-62 written-out dates', () => {
  it('formats sentences, tables, axes and ranges', () => {
    assert.equal(formatDateLong('2026-11-24'), 'November 24, 2026');
    assert.equal(formatDateShort('2026-11-24'), 'Nov 24, 2026');
    assert.equal(formatDateAxis('2026-11-24'), 'Nov 24');
    assert.equal(formatDateRange('2026-11-24', '2026-11-28'), 'November 24–28, 2026');
    assert.equal(formatDateRange('2026-11-24', '2026-12-02'), 'November 24 – December 2, 2026');
    assert.equal(formatDateRange('2026-12-29', '2027-01-02'), 'December 29, 2026 – January 2, 2027');
    assert.equal(formatDateRange('2026-11-24', '2026-11-24'), 'November 24, 2026');
    for (const bad of ['', null, '2026-02-30', '11/24/2026']) {
      assert.equal(formatDateLong(bad), '');
      assert.equal(formatDateRange(bad, '2026-11-24'), '');
    }
  });
});

describe('S8-56 complaint starts with a tracking number check', () => {
  it('calls the public check route and shows the found line', async () => {
    const calls = [];
    const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => ({ found: true, office_name: 'Registrar’s Office', service_name: 'Request for TOR', date: '2026-11-18' }) }; };
    const result = await checkTrackingNumber(' 2026-00123 ', fetchImpl);
    assert.equal(calls[0], '/api/logs/complaints/tracking-check?tracking_no=2026-00123');
    assert.equal(foundLine(result), 'Found: Registrar’s Office — Request for TOR, November 18, 2026');
    assert.match(TRACKING_NOT_FOUND, /could not find this tracking number/);
  });
  it('the form opens only after the number is found and locks the office', () => {
    const form = read('src/components/complaints/ComplaintForm.js');
    assert.match(form, /check\.status === 'found' \? \(\s*<form[^>]*data-testid="complaint-form"/);
    assert.match(form, /data-testid="complaint-office-locked"/);
  });
});

describe('S8-25 overdue wording and no fake Escalate', () => {
  it('says how long past the limit in working time, from the numbers the server sent', () => {
    assert.equal(overdueByText(135), 'Overdue by 2 h 15 min (working time)');
    const m = deriveLateRiskItemMetrics({ level: 'HIGH', working_minutes_left: 0, share_used: 1.4, limit_minutes: 300, elapsed_working_minutes: 435, overdue_working_minutes: 135 });
    assert.equal(m.overdueText, 'Overdue by 2 h 15 min (working time)');
    assert.equal(deriveLateRiskItemMetrics({ level: 'LOW', working_minutes_left: 120, share_used: 0.4 }).overdueText, null);
  });
  it('the late-risk screen has no Confirm Escalation button that reports an action nothing stored', () => {
    const screen = read('src/components/analytics/LateRiskSection.js');
    assert.ok(!/Confirm Escalation|Escalation logged|Follow-up notification queued/.test(screen));
    assert.match(screen, /data-testid="late-risk-drawer-open-record"/);
  });
});
