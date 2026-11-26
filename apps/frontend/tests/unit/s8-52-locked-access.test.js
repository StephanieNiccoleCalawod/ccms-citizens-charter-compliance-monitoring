// S8-52: "You don't have access to this yet. Request access" on a locked feature, the extra access from /me, and Remove on the Accounts page (not a browser).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { getExtraAccessKeys } from '../../src/lib/api/account.js';
import { LOCKED_HINT, extraAccessKeys, hasExtraAccess, lockedNotice } from '../../src/lib/ui/access.js';
import { staffAccessFrom } from '../../src/lib/ui/account.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('the notice on a locked feature', () => {
  it('is for an Office Head or Office Staff only, and opens the request form with that permission chosen', () => {
    for (const role of [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) {
      assert.deepEqual(lockedNotice('EXPORT_CSV', role), { message: LOCKED_HINT, action: 'Request access', href: '/access?permission=EXPORT_CSV' });
    }
    for (const role of [ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, undefined]) assert.equal(lockedNotice('EXPORT_CSV', role), null);
    assert.equal(lockedNotice('EXPORT_CSV', ROLES.OFFICE_STAFF, 'No queue yet.').message, 'No queue yet.');
  });
  it('is shown on the four locked features and nowhere a role could not ask', () => {
    assert.match(read('src/components/queue/QueuePanel.js'), /permissionKey="VIEW_OFFICE_QUEUE"/);
    assert.match(read('src/components/reports/PeopleReport.js'), /permissionKey="REPORTS_PER_PERSON"/);
    assert.match(read('src/components/reports/ReportDetail.js'), /permissionKey="EXPORT_CSV"/);
    assert.match(read('src/components/transactions/StartTransactionForm.js'), /permissionKey="RECORD_PAST_TRANSACTIONS"/);
    assert.match(read('src/components/access/LockedNotice.js'), /if \(!notice\) return null/);
  });
});

describe('extra access from /me', () => {
  const me = { extra_access: [{ permission_key: 'RECORD_PAST_TRANSACTIONS', ends_on: '2026-12-15' }, { permission_key: 'REPORTS_PER_PERSON', ends_on: '2026-12-20' }] };
  it('reads the permission keys, and anything unclear is none', () => {
    assert.deepEqual(extraAccessKeys(me), ['RECORD_PAST_TRANSACTIONS', 'REPORTS_PER_PERSON']);
    for (const bad of [null, {}, { extra_access: 'x' }]) assert.deepEqual(extraAccessKeys(bad), []);
    assert.equal(hasExtraAccess(extraAccessKeys(me), 'EXPORT_CSV'), false);
    assert.equal(hasExtraAccess(null, 'EXPORT_CSV'), false);
  });
  it('a granted "Reports per person" opens the Reports page for Office Staff, like the switch does', () => {
    assert.equal(staffAccessFrom({ what_i_can_do: [] }).reports, false);
    assert.equal(staffAccessFrom(me).reports, true);
    assert.equal(staffAccessFrom({ what_i_can_do: [{ switch_key: 'STAFF_VIEW_REPORTS', switch_on: true }] }).reports, true);
    assert.equal(staffAccessFrom({ extra_access: [{ permission_key: 'EXPORT_CSV' }] }).reports, false);
  });
  it('is asked once a minute, and a failed call means none', async () => {
    let calls = 0; let clock = 1_000_000;
    const fetcher = async () => { calls += 1; return me; };
    const opts = { fetcher, now: () => clock, force: true };
    assert.deepEqual(await getExtraAccessKeys(opts), ['RECORD_PAST_TRANSACTIONS', 'REPORTS_PER_PERSON']);
    await getExtraAccessKeys({ fetcher, now: () => clock });
    clock += 30_000; await getExtraAccessKeys({ fetcher, now: () => clock });
    assert.equal(calls, 1);
    clock += 31_000; await getExtraAccessKeys({ fetcher, now: () => clock });
    assert.equal(calls, 2);
    assert.deepEqual(await getExtraAccessKeys({ fetcher: async () => { throw new Error('down'); }, now: () => clock, force: true }), []);
  });
});

describe('Remove on the Accounts page', () => {
  it('the row menu shows "Extra access" only for an account that has some, and Remove calls the same revoke as the Access page', () => {
    const page = read('src/app/accounts/page.js');
    assert.match(page, /Extra access \(\$\{grantsOf\(account\)\.length\}\)/);
    assert.match(page, /grantsOf\(account\)\.length \? \[/);
    const modal = read('src/components/access/AccountAccessModal.js');
    assert.match(modal, /revokeAccessGrant\(removing\.grant_id\)/);
    assert.match(modal, /ConfirmDialog/);
  });
});

describe('notification tabs', () => {
  it('every tab of the bell and of the Notification Center shows its count', () => {
    for (const f of ['NotificationPanel', 'NotificationCenter']) assert.doesNotMatch(read(`src/components/notifications/${f}.js`), /t\.id === 'all' \|\| t\.id === 'unread'/, f);
  });
});
