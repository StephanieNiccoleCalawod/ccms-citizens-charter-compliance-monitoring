import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { buildPeopleQuery, peopleCsv, peopleRows, peopleScopeText, reportCsvName, scopesFor } from '../../src/lib/ui/people-report.js';

const report = {
  scope: 'all_staff', from: '2026-11-01', to: '2026-11-30',
  items: [{ person_id: 'a', person_name: 'Ana, Cruz', handled: 4, on_time: 3, late: 1, on_time_percent: 75, median_working_minutes: 90, paused_minutes: 0, rating_average: 4.5, rating_count: 2, linked_complaints: null }],
  totals: { handled: 4, on_time: 3, late: 1, on_time_percent: 75 },
};

describe('S8-54 reports by person', () => {
  it('Office Staff only get their own report; heads and admins get all three scopes', () => {
    assert.deepEqual(scopesFor(ROLES.OFFICE_STAFF).map((s) => s.value), ['person']);
    assert.equal(scopesFor(ROLES.OFFICE_HEAD).length, 3);
    assert.equal(scopesFor(ROLES.EXECUTIVE).length, 0);
  });
  it('builds the query and asks for what is missing', () => {
    const user = { id: 'u1', officeId: 'o1' };
    assert.equal(buildPeopleQuery({ role: ROLES.SUPER_ADMIN, scope: 'all_staff', from: '2026-11-01', to: '2026-11-30', user }).error, 'Choose an office.');
    assert.equal(buildPeopleQuery({ role: ROLES.OFFICE_HEAD, scope: 'person', from: '2026-11-01', to: '2026-11-30', user }).error, 'Choose a person.');
    assert.equal(buildPeopleQuery({ role: ROLES.OFFICE_HEAD, scope: 'office', from: '2026-12-01', to: '2026-11-30', user }).error, 'The first date must not be after the last date.');
    assert.deepEqual(buildPeopleQuery({ role: ROLES.OFFICE_STAFF, scope: 'office', from: '2026-11-01', to: '2026-11-30', user }),
      { scope: 'person', officeId: 'o1', personId: 'u1', from: '2026-11-01', to: '2026-11-30' });
  });
  it('S8-6x a Super Admin\'s Whole office needs no office at all - every office combined - unlike every other scope/role', () => {
    const user = { id: 'u1', officeId: null };
    assert.deepEqual(buildPeopleQuery({ role: ROLES.SUPER_ADMIN, scope: 'office', from: '2026-11-01', to: '2026-11-30', user }),
      { scope: 'office', officeId: undefined, personId: undefined, from: '2026-11-01', to: '2026-11-30' });
    // An office picked under a different scope is dropped once "Whole office" is chosen (never silently all-offices-or-one).
    assert.deepEqual(buildPeopleQuery({ role: ROLES.SUPER_ADMIN, scope: 'office', officeId: 'o1', from: '2026-11-01', to: '2026-11-30', user }),
      { scope: 'office', officeId: undefined, personId: undefined, from: '2026-11-01', to: '2026-11-30' });
  });
  it('S8-6x says "All offices" only for a Whole office report with no office_id, never a named office', () => {
    assert.equal(peopleScopeText({ scope: 'office', office_id: null }, '', ''), 'All offices');
    assert.equal(peopleScopeText({ scope: 'office', office_id: 'o1' }, 'Registrar', ''), 'Registrar');
  });
  it('rows end with the total and say "No rate yet" without a rate', () => {
    const rows = peopleRows(report);
    assert.equal(rows.at(-1).label, 'All together');
    assert.equal(peopleRows({ ...report, items: [{ person_id: 'b', person_name: null, on_time_percent: null }] })[0].label, 'Name not available');
  });
});

describe('S8-55 CSV', () => {
  it('has a byte-order mark, one header row, MM/DD/YYYY dates and quotes commas', () => {
    const csv = peopleCsv(report);
    assert.ok(csv.startsWith('﻿Person,'));
    assert.match(csv, /"Ana, Cruz"/);
    assert.match(csv, /11\/01\/2026,11\/30\/2026/);
  });
  it('names the file CCCMS_Report_<Office>_<MMDDYYYY>.csv', () => {
    assert.equal(reportCsvName("Registrar's Office", '2026-11-25'), 'CCCMS_Report_Registrar_s_Office_11252026.csv');
  });
});
