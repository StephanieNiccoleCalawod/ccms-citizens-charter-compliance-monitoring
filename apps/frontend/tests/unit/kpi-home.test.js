import { ROLES } from 'ccms-shared/roles';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getComplaintSummary, getKpis, getOfficeNames, getOfficePendingTransactions, KPIS_API } from '../../src/lib/api/kpis.js';
import { DEFAULT_PERIOD, ON_TIME_TARGET, failureMessage, groupByFor, minutesText, officeRows, oldestFirstPending, rateText, sortOfficeRows, staffRows, targetNote, tilesFor } from '../../src/lib/ui/kpi-home.js';

const read = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const bucket = (over = {}) => ({ received: 10, cancelled: 1, pending: { count: 2 }, results: { on_time: 6, late: 1, late_auto_closed: 1, late_total: 2, on_time_rate: 75 }, ...over });

describe('CC036 / CC037 KPI home rules', () => {
  it('targets 100% and states the gap in words', () => {
    assert.equal(ON_TIME_TARGET, 100);
    assert.equal(targetNote(75), '25 points below the 100% target');
    assert.equal(targetNote(100), 'Target of 100% met');
    assert.equal(targetNote(null), '');
  });
  it('a missing rate is words, never 0% or 100%', () => {
    assert.equal(rateText(null), 'No rate yet');
    assert.equal(rateText(87.5), '87.5%');
  });
  it('tiles are the module figures, unchanged', () => {
    const t = Object.fromEntries(tilesFor(bucket()).map((x) => [x.key, x]));
    assert.equal(t.received.value, 10);
    assert.equal(t.on_time.value, 6);
    assert.equal(t.late.value, 2);
    assert.equal(t.late.note, '1 closed automatically');
    assert.equal(t.pending.value, 2);
    assert.equal(t.cancelled.value, 1);
    assert.equal(t.on_time_rate.value, '75%');
  });
  it('DEF-16: tiles read the figures under "totals" of the whole answer', () => {
    const t = Object.fromEntries(tilesFor({ period: 'monthly', group_by: 'total', totals: bucket({ received: 19 }), groups: [] }).map((x) => [x.key, x]));
    assert.equal(t.received.value, 19);
    assert.equal(t.on_time.value, 6);
  });
  it('tiles of nothing are zeros, not NaN', () => {
    assert.equal(tilesFor(null).find((x) => x.key === 'received').value, 0);
  });
  it('staff rows are named and sorted; a missing name does not invent one', () => {
    const rows = staffRows([{ user_id: 'b', ...bucket() }, { user_id: 'a', ...bucket() }], new Map([['b', 'Zed'], ['a', 'Ann']]));
    assert.deepEqual(rows.map((r) => r.name), ['Ann', 'Zed']);
    assert.equal(staffRows([{ user_id: 'c', ...bucket() }])[0].name, 'Staff member');
  });
  it('office rows put the lowest rate first and no-rate offices last', () => {
    const rows = officeRows([{ office_id: 'x', results: { on_time_rate: 90 } }, { office_id: 'y', results: { on_time_rate: null } }, { office_id: 'z', results: { on_time_rate: 50 } }], new Map([['x', 'X'], ['y', 'Y'], ['z', 'Z']]));
    assert.deepEqual(rows.map((r) => r.id), ['z', 'x', 'y']);
  });
  it('the Executive asks per office and never per staff', () => {
    assert.equal(groupByFor(ROLES.EXECUTIVE), 'office'); // DEF-17: the role value is lower case
    assert.equal(groupByFor('executive'), 'office');
    assert.equal(groupByFor('office_head'), 'staff');
    assert.equal(groupByFor('office_staff'), 'staff');
  });
  it('durations and failures read in words', () => {
    assert.equal(minutesText(150), '2 h 30 min');
    assert.equal(minutesText(null), '-');
    assert.match(failureMessage({ status: 403 }), /permission/);
    assert.match(failureMessage(new Error('x')), /could not be loaded/);
  });
  it('the client calls the KPI endpoint with a clean query', async () => {
    let url;
    await getKpis({ period: 'monthly', officeId: 'o1', groupBy: 'staff' }, async (u) => { url = u; return {}; });
    assert.equal(url, `${KPIS_API}?period=monthly&office_id=o1&group_by=staff`);
  });
  it('defaults period to half_year and renders all 12 expanded KPI tiles', () => {
    assert.equal(DEFAULT_PERIOD, 'half_year');
    const fullBucket = bucket({
      auto_closed: 1,
      outcomes: { completed: 8, granted: 6, disapproved: 2, not_recorded: 0 },
      pending: { count: 2, oldest_age_minutes: 95 },
      time: { average_minutes: 45, median_minutes: 40, p90_minutes: 80 },
      early: { count: 3, average_margin_minutes: 15 },
      queue_wait: { measured: 5, average_minutes: 12 },
    });
    const t = Object.fromEntries(tilesFor(fullBucket).map((x) => [x.key, x]));
    assert.equal(t.completed.value, 8);
    assert.equal(t.average_time.value, '45 min');
    assert.equal(t.median_time.value, '40 min');
    assert.equal(t.pending.note, 'Oldest 1 h 35 min');
    assert.equal(t.early.value, 3);
    assert.equal(t.early.note, 'Avg margin 15 min');
    assert.equal(t.auto_closed.value, 1);
    assert.equal(t.queue_wait.value, '12 min');
  });
  it('sorts campus office comparison rows by rate, counts, or name while keeping missing rates last', () => {
    const base = [
      { id: '1', name: 'Registrar', received: 50, onTime: 40, late: 10, rate: 80, pending: 2 },
      { id: '2', name: 'Cashier', received: 20, onTime: 19, late: 1, rate: 95, pending: 5 },
      { id: '3', name: 'Library', received: 0, onTime: 0, late: 0, rate: null, pending: 1 },
    ];
    assert.deepEqual(sortOfficeRows(base, { key: 'rate', direction: 'desc' }).map((r) => r.name), ['Cashier', 'Registrar', 'Library']);
    assert.deepEqual(sortOfficeRows(base, { key: 'received', direction: 'desc' }).map((r) => r.name), ['Registrar', 'Cashier', 'Library']);
    assert.deepEqual(sortOfficeRows(base, { key: 'name', direction: 'asc' }).map((r) => r.name), ['Cashier', 'Library', 'Registrar']);
  });
  it('orders pending transactions oldest first and computes complaint summary with 403 handling', async () => {
    const sorted = oldestFirstPending([
      { transaction_id: 'b', tracking_no: 'T-2', status: 'ON_HOLD', started_at: '2026-11-10T02:00:00Z' },
      { transaction_id: 'a', tracking_no: 'T-1', status: 'IN_PROGRESS', started_at: '2026-11-10T01:00:00Z' },
      { transaction_id: 'c', tracking_no: 'T-3', status: 'COMPLETED', started_at: '2026-11-09T01:00:00Z' },
    ]);
    assert.deepEqual(sorted.map((x) => x.tracking_no), ['T-1', 'T-2']);

    const calls = [];
    const page1 = await getOfficePendingTransactions({ page: 1, pageSize: 2 }, async (url) => {
      calls.push(url);
      return {
        items: [
          { transaction_id: '2', tracking_no: 'T-05', status: 'ON_HOLD', started_at: '2026-11-10T01:00:00Z' },
          { transaction_id: '1', tracking_no: 'T-10', status: 'IN_PROGRESS', started_at: '2026-11-10T03:00:00Z' },
        ],
        page: 1,
        page_size: 2,
        total: 5,
      };
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /open=true/);
    assert.match(calls[0], /sort=oldest/);
    assert.match(calls[0], /page=1/);
    assert.match(calls[0], /page_size=2/);
    assert.deepEqual(page1.items.map((x) => x.tracking_no), ['T-05', 'T-10']);
    assert.equal(page1.total, 5);

    const summary = await getComplaintSummary({ officeId: 'o1' }, async (url) => {
      if (url.includes('status=RECEIVED')) return { total: 3 };
      if (url.includes('status=ACKNOWLEDGED')) return { total: 2 };
      if (url.includes('overdue=true')) return { total: 1 };
      return { total: 4 };
    });
    assert.deepEqual(summary, { restricted: false, open: 5, received: 3, acknowledged: 2, overdue: 1, resolved: 4 });

    const denied = await getComplaintSummary({ officeId: 'o1' }, async () => {
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    });
    assert.deepEqual(denied, { restricted: true });
  });
  it('includes every active office with zero counts and No rate yet when a comparison period has no transactions', async () => {
    const activeNames = await getOfficeNames(async () => ({
      items: [
        { office_id: 'o1', office_name: 'Registrar', is_active: true },
        { office_id: 'o2', office_name: 'Guidance', is_active: true },
        { office_id: 'o3', office_name: 'Archived Office', is_active: false },
      ],
    }));
    assert.equal(activeNames.has('o3'), false);

    const rows = officeRows([
      { office_id: 'o1', received: 4, pending: { count: 1 }, results: { on_time: 3, late_total: 1, on_time_rate: 75 } },
    ], activeNames);
    assert.equal(rows.length, 2);
    const guidance = rows.find((r) => r.id === 'o2');
    assert.deepEqual(guidance, { id: 'o2', name: 'Guidance', received: 0, onTime: 0, late: 0, rate: null, pending: 0 });
    assert.equal(rateText(guidance.rate), 'No rate yet');
  });
});

describe('Office Home and Campus Home pages', () => {
  const home = read('components/home/KpiHome.js');
  it('the placeholders are gone and both pages use the shared home', () => {
    for (const p of ['app/office/page.js', 'app/campus/page.js']) {
      const text = read(p);
      assert.match(text, /KpiHome/);
      assert.doesNotMatch(text, /coming in a later sprint/);
    }
  });
  it('keeps each page to its roles', () => {
    assert.match(read('app/office/page.js'), /allowedRoles=\{\[ROLES\.OFFICE_HEAD, ROLES\.OFFICE_STAFF\]\}/);
    assert.match(read('app/campus/page.js'), /allowedRoles=\{\[ROLES\.EXECUTIVE\]\}/);
  });
  it('links to Dashboard (/), includes pending list + complaints on Office Home, sortable table on Campus Home, and never asks Executive for staff figures', () => {
    assert.match(home, /href="\/"[^>]*data-testid="kpi-dashboard-link"/);
    assert.doesNotMatch(home, /href="\/insights"/);
    assert.match(home, /data-testid="office-pending-list"/);
    assert.match(home, /data-testid="office-complaints-summary"/);
    assert.match(home, /data-testid="campus-office-table"/);
    assert.match(home, /onSortChange=\{toggleOfficeSort\}/);
    assert.doesNotMatch(home, /groupBy: 'staff'/);
    assert.match(home, /groupByFor\(user\.role\)/);
  });
  it('only an office-bound person is scoped by office; the Executive is not', () => {
    assert.match(home, /officeId: executive \? undefined : user\.officeId/);
  });
  it('uses server-side pagination for oldest pending transactions in KpiHome', () => {
    assert.match(home, /getOfficePendingTransactions\(\{ page: pendingPage, pageSize: pendingPageSize \}\)/);
    assert.match(home, /onPage:\s*setPendingPage/);
    assert.match(home, /onPageSizeChange/);
  });
});
