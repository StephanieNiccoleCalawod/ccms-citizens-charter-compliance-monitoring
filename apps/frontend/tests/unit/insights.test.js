// CC053 / CC054 Insights page: wording, colours, calls and source checks (not a browser).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { getInsightsCell, getInsightsOverview, getOfficeLateRisk, retrainOfficeModels } from '../../src/lib/api/insights.js';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import { filterByFlag, heatClass, heatLabel, minutesText, sentenceText, sortRows } from '../../src/lib/ui/insights.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const names = { offices: { o1: 'Registrar' }, services: { s1: 'TOR Request' } };

describe('calls', () => {
  it('use the gateway addresses', async () => {
    const calls = [];
    const f = async (path, init) => { calls.push([path, init?.method ?? 'GET']); return {}; };
    await getInsightsOverview({ period: 'monthly', officeId: 'o1' }, f);
    await getInsightsCell({ officeId: 'o1', serviceId: 's1' }, f);
    await getOfficeLateRisk('o1', f);
    await retrainOfficeModels('o1', f);
    assert.deepEqual(calls.map((c) => c[0]), [
      '/api/logs/analytics/insights/overview?period=monthly&office_id=o1',
      '/api/logs/analytics/insights/cell?office_id=o1&service_id=s1',
      '/api/operations/analytics/late-risk?officeId=o1',
      '/api/operations/analytics/late-risk/retrain',
      '/api/operations/analytics/forecast/retrain',
    ]);
  });
});

describe('wording', () => {
  it('writes each template from its numbers and the catalogue names', () => {
    assert.match(sentenceText({ template: 1, params: { office_id: 'o1', service_id: 's1', late_rate: 40, late: 4, completed: 10 } }, names), /TOR Request at Registrar.*40% late \(4 of 10/);
    assert.match(sentenceText({ template: 2, params: { change: -5, previous_on_time_rate: 90, on_time_rate: 85 } }, names), /down 5%/);
    assert.match(sentenceText({ template: 2, params: { change: 5, previous_on_time_rate: 85, on_time_rate: 90 } }, names), /up 5%/);
    assert.match(sentenceText({ template: 5, params: { flag: 'LIMIT_OFTEN_MISSED', office_id: 'o1', service_id: 's1', late_rate: 30, completed: 25 } }, names), /often missed/);
    assert.match(sentenceText({ template: 6, params: { auto_closed: 1, received: 9 } }, names), /1 transaction was closed automatically/);
    assert.equal(sentenceText({ template: 99 }, names), '');
  });
  it('falls back when a name is missing', () => {
    assert.match(sentenceText({ template: 3, params: { service_id: 'x', service_code: 'ABC', late: 2, completed: 5 } }, {}), /ABC has the most late/);
  });
});

describe('heatmap', () => {
  it('is grey and says "Too few" under 5 completed, never coloured', () => {
    const c = { completed: 4, late: 4, late_rate: 100, too_few: true };
    assert.match(heatClass(c), /slate/);
    assert.equal(heatLabel(c), 'Too few');
  });
  it('colours by late rate', () => {
    assert.match(heatClass({ completed: 10, late_rate: 0 }), /green/);
    assert.match(heatClass({ completed: 10, late_rate: 50 }), /red/);
    assert.equal(heatLabel({ completed: 10, late_rate: 12.5 }), '12.5% late');
  });
});

describe('table helpers', () => {
  const rows = [{ late_rate: 5, flags: [] }, { late_rate: 30, flags: ['LIMIT_OFTEN_MISSED'] }];
  it('sorts and filters', () => {
    assert.equal(sortRows(rows, 'late_rate')[0].late_rate, 30);
    assert.equal(sortRows(rows, 'late_rate', 'asc')[0].late_rate, 5);
    assert.equal(filterByFlag(rows, 'LIMIT_OFTEN_MISSED').length, 1);
    assert.equal(filterByFlag(rows, '').length, 2);
  });
  it('formats minutes', () => { assert.equal(minutesText(90), '1 h 30 min'); assert.equal(minutesText(45), '45 min'); assert.equal(minutesText('x'), '–'); });
});

describe('page rules', () => {
  it('lives on the Dashboard: no separate menu item for any role', () => {
    for (const role of [ROLES.SUPER_ADMIN, ROLES.EXECUTIVE, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) assert.ok(!appNavForRole(role, {}).some((i) => i.href === '/insights'), role);
    assert.match(read('src/app/page.js'), /<InsightsPage user=\{user\} \/>/);
  });
  it('only Super Admin sees Retrain, and the page uses no apiFetch directly for charts', () => {
    const src = read('src/components/insights/InsightsPage.js');
    assert.match(src, /isAdmin && modelOffice/);
  });
});
