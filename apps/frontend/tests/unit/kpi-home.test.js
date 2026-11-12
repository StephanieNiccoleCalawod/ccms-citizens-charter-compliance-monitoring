import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getKpis, KPIS_API } from '../../src/lib/api/kpis.js';
import { ON_TIME_TARGET, failureMessage, groupByFor, minutesText, officeRows, rateText, staffRows, targetNote, tilesFor } from '../../src/lib/ui/kpi-home.js';

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
    assert.equal(groupByFor('EXECUTIVE'), 'office');
    assert.equal(groupByFor('OFFICE_HEAD'), 'staff');
    assert.equal(groupByFor('OFFICE_STAFF'), 'staff');
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
  it('links to Insights and never asks the Executive for staff figures', () => {
    assert.match(home, /data-testid="kpi-insights-link"/);
    assert.doesNotMatch(home, /groupBy: 'staff'/);
    assert.match(home, /groupByFor\(user\.role\)/);
  });
  it('only an office-bound person is scoped by office; the Executive is not', () => {
    assert.match(home, /officeId: executive \? undefined : user\.officeId/);
  });
});
