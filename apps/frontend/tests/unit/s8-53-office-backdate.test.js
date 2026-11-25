import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { BACKDATE_OFFICE_MESSAGES, officeAllowsPast } from '../../src/lib/ui/backdate.js';

const read = (path) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

describe('S8-53 past transactions per office', () => {
  it('lets the Super Admin always, others only when the office switch is on', () => {
    assert.equal(officeAllowsPast({ allow_backdated_transactions: false }, 'SUPER_ADMIN'), true);
    assert.equal(officeAllowsPast({ allow_backdated_transactions: false }, 'OFFICE_STAFF'), false);
    assert.equal(officeAllowsPast({ allow_backdated_transactions: true }, 'OFFICE_HEAD'), true);
  });

  it('does not hide the option for an office it could not read; the server still decides', () => {
    assert.equal(officeAllowsPast(undefined, 'OFFICE_STAFF'), true);
    assert.equal(officeAllowsPast({}, 'OFFICE_STAFF'), true);
  });

  it('hides the Late entry section in the start form and closes it if the office changes', () => {
    const form = read('components/transactions/StartTransactionForm.js');
    assert.match(form, /\{pastAllowed \? <Section[^>]*title="Late entry"/);
    assert.match(form, /if \(!pastAllowed && past\.enabled\) togglePast\(false\)/);
  });

  it('has a Settings switch for the Super Admin that saves through the office route and says the result', () => {
    const settings = read('app/settings/transactions/page.js');
    assert.match(settings, /user\.role === ROLES\.SUPER_ADMIN \? <OfficeBackdate \/>/);
    const panel = read('app/settings/OfficeBackdate.js');
    assert.match(panel, /method: 'PATCH', body: \{ allow_backdated_transactions: on \}/);
    assert.match(panel, /notify\.success/);
    assert.equal(BACKDATE_OFFICE_MESSAGES.saved('Registrar', true), 'Registrar can now record past transactions.');
    assert.equal(BACKDATE_OFFICE_MESSAGES.saved('Registrar', false), 'Registrar can no longer record past transactions.');
  });
});
