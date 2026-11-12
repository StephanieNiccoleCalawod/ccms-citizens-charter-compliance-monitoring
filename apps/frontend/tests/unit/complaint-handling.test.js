// CC034 / CC035 staff complaints page: rules, calls and source checks (not a browser).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { acknowledgeComplaint, getComplaintForStaff, listComplaintsForStaff, resolveComplaint } from '../../src/lib/api/complaint-handling.js';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import { canHandleComplaints, complaintActions, dueText, failureMessage, replyError, seesContact, statusText } from '../../src/lib/ui/complaint-handling.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('calls', () => {
  it('use the right addresses, methods and bodies', async () => {
    const calls = [];
    const f = async (path, options) => { calls.push([path, options]); return {}; };
    await listComplaintsForStaff({ officeId: 'o', status: 'RECEIVED', overdue: true, page: 2, pageSize: 20 }, f);
    await listComplaintsForStaff({}, f);
    await getComplaintForStaff('a b', f);
    await acknowledgeComplaint('x', f);
    await resolveComplaint('x', 'Done', f);
    assert.equal(calls[0][0], '/api/logs/complaints?office_id=o&status=RECEIVED&overdue=true&page=2&page_size=20');
    assert.equal(calls[1][0], '/api/logs/complaints');
    assert.equal(calls[2][0], '/api/logs/complaints/a%20b');
    assert.deepEqual(calls[3], ['/api/logs/complaints/x/acknowledge', { method: 'POST', body: {} }]);
    assert.deepEqual(calls[4], ['/api/logs/complaints/x/resolve', { method: 'POST', body: { reply: 'Done' } }]);
  });
});

describe('rules', () => {
  it('only Super Admin and Office Head handle complaints and see the contact', () => {
    for (const role of [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD]) { assert.equal(canHandleComplaints(role), true); assert.equal(seesContact(role), true); }
    for (const role of [ROLES.EXECUTIVE, ROLES.OFFICE_STAFF]) { assert.equal(canHandleComplaints(role), false); assert.equal(seesContact(role), false); }
  });
  it('offers the next step only, forward only', () => {
    assert.deepEqual(complaintActions({ status: 'RECEIVED' }, ROLES.OFFICE_HEAD), { acknowledge: true, resolve: false });
    assert.deepEqual(complaintActions({ status: 'ACKNOWLEDGED' }, ROLES.OFFICE_HEAD), { acknowledge: false, resolve: true });
    assert.deepEqual(complaintActions({ status: 'RESOLVED' }, ROLES.SUPER_ADMIN), { acknowledge: false, resolve: false });
    assert.deepEqual(complaintActions({ status: 'RECEIVED' }, ROLES.EXECUTIVE), { acknowledge: false, resolve: false });
    assert.deepEqual(complaintActions({ status: 'ACKNOWLEDGED' }, ROLES.OFFICE_STAFF), { acknowledge: false, resolve: false });
  });
  it('needs a reply of 1 to 2000 characters', () => {
    assert.ok(replyError('')); assert.ok(replyError('   ')); assert.ok(replyError('x'.repeat(2001)));
    assert.equal(replyError(' ok '), ''); assert.equal(replyError('x'.repeat(2000)), '');
  });
  it('words status, due date and failures', () => {
    assert.equal(statusText({ status: 'ACKNOWLEDGED', overdue: true }), 'Acknowledged, overdue');
    assert.equal(statusText({ status: 'RESOLVED', overdue: false }), 'Resolved');
    assert.equal(dueText({ due_at: null }), 'Not available yet');
    assert.match(failureMessage({ status: 403 }), /permission/);
    assert.match(failureMessage({ status: 409, code: 'COMPLAINT_INVALID_STATE', message: 'Acknowledge the complaint before resolving it.' }), /Acknowledge/);
  });
});

describe('menu and page', () => {
  const labels = (role, access) => appNavForRole(role, access).map((i) => i.label);
  it('Complaints is in the menu for Super Admin, Office Head and Executive; for Office Staff only while switch 3 is on', () => {
    for (const role of [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.EXECUTIVE]) assert.ok(labels(role).includes('Complaints'), role);
    assert.ok(!labels(ROLES.OFFICE_STAFF).includes('Complaints'));
    assert.ok(!labels(ROLES.OFFICE_STAFF, { complaints: false }).includes('Complaints'));
    assert.ok(labels(ROLES.OFFICE_STAFF, { complaints: true }).includes('Complaints'));
  });
  it('the page is guarded by role, uses the shared table, and keeps the citizen contact behind the role check', () => {
    const page = read('src/app/complaints/page.js');
    assert.match(page, /allowedRoles=\{\[ROLES\.SUPER_ADMIN, ROLES\.OFFICE_HEAD, ROLES\.EXECUTIVE, ROLES\.OFFICE_STAFF\]\}/);
    const view = read('src/components/complaints/ComplaintsPage.js');
    assert.match(view, /DataTable/);
    assert.match(view, /seesContact\(role\)/);
    assert.doesNotMatch(view, /<table/);
  });
});
