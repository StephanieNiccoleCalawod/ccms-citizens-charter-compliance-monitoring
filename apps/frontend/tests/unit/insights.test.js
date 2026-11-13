// CC053 / CC054 Insights page: wording, colours, calls and source checks (not a browser).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { getInsightsCell, getInsightsOverview, getOfficeLateRisk, retrainOfficeModels } from '../../src/lib/api/insights.js';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import { filterByFlag, heatClass, heatLabel, minutesText, sentenceText, sortRows, forecastSentence, highRiskSentence, mergeSentences, todayForecast } from '../../src/lib/ui/insights.js';

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

describe('wording (spec 3.3, six fixed templates)', () => {
  it('writes each template from its numbers and the catalogue names', () => {
    assert.equal(sentenceText({ template: 1, params: { office_id: 'o1', x: 31.4 } }, names), 'Registrar requests are expected to rise 31% next week');
    assert.equal(sentenceText({ template: 2, params: { service_id: 's1', late_rate: 40, period: 'monthly' } }, names), 'TOR Request was late 40% of the time in this month');
    assert.equal(sentenceText({ template: 3, params: { office_id: 'o1', from_rate: 30, to_rate: 12.5, direction: 'fell' } }, names), "Registrar's late rate fell from 30% to 12.5%");
    assert.equal(sentenceText({ template: 3, params: { office_id: 'o1', from_rate: 10, to_rate: 25, direction: 'rose' } }, names), "Registrar's late rate rose from 10% to 25%");
    assert.equal(sentenceText({ template: 4, params: { service_id: 's1', share_of_limit: 18 } }, names), 'TOR Request is usually done in 18% of its time limit');
    assert.equal(sentenceText({ template: 5, params: { n: 2 } }, names), '2 unusual cases took more than three times the usual time');
    assert.equal(sentenceText({ template: 6, params: { n: 1 } }, names), '1 open transaction is at high risk of being late');
    assert.equal(sentenceText({ template: 6, params: { n: 3 } }, names), '3 open transactions are at high risk of being late');
    assert.equal(sentenceText({ template: 99 }, names), '');
  });
  it('falls back when a name is missing', () => {
    assert.match(sentenceText({ template: 2, params: { service_id: 'x', service_code: 'ABC', late_rate: 25, period: 'weekly' } }, {}), /^ABC was late 25%/);
  });
  it('never says simulated or test (only the disclosure line may)', () => {
    for (let t = 1; t <= 6; t += 1) assert.doesNotMatch(sentenceText({ template: t, params: { n: 1, x: 1, late_rate: 1 } }, names), /simulat|test|seed/i);
  });
});

describe('sentences built on the screen from Operations', () => {
  const day = (i, count) => ({ date: `2026-11-0${i}`, count });
  const base = { status: 'SUCCESS', weeklyTotal: 60, history: [day(1, 10), day(2, 10), day(3, 10), day(4, 10), day(5, 10)] };
  it('template 1 needs a ready forecast, 5 days of history and a rise of 20% or more', () => {
    assert.equal(forecastSentence(base, 'o1').params.x, 20);
    assert.equal(forecastSentence({ ...base, weeklyTotal: 59 }, 'o1'), null);
    assert.equal(forecastSentence({ ...base, status: 'NOT_ENOUGH_HISTORY' }, 'o1'), null);
    assert.equal(forecastSentence({ ...base, history: base.history.slice(1) }, 'o1'), null);
    assert.equal(forecastSentence(base, ''), null);
  });
  it('template 6 counts High items only', () => {
    assert.equal(highRiskSentence({ items: [{ level: 'HIGH' }, { level: 'MEDIUM' }, { level: 'HIGH' }] }).params.n, 2);
    assert.equal(highRiskSentence({ items: [{ level: 'LOW' }] }), null);
    assert.equal(highRiskSentence(null), null);
  });
  it('ranks all candidates by score and shows at most 6', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, template: 2, score: 10 + i }));
    const out = mergeSentences(many, [{ id: 't6', template: 6, score: 1 }, { id: 't1', template: 1, score: 100 }], 6);
    assert.equal(out.length, 6);
    assert.equal(out[0].id, 't1');
    assert.ok(!out.some((s) => s.id === 't6'));
  });
});

describe('Pulse: today\'s forecast', () => {
  const now = new Date('2026-11-12T02:00:00Z'); // 10:00 in Manila on 12 Nov
  const forecast = { status: 'SUCCESS', forecast: [{ date: '2026-11-12', point: 20, lower: 15, upper: 25 }] };
  it('is on track at or above the low end, behind below it', () => {
    assert.equal(todayForecast(forecast, { completed_today: 10, open_now: 5 }, now).status, 'on track');
    assert.equal(todayForecast(forecast, { completed_today: 8, open_now: 6 }, now).status, 'behind');
    assert.deepEqual(todayForecast(forecast, { completed_today: 8, open_now: 6 }, now), { expected: 20, lower: 15, upper: 25, status: 'behind' });
  });
  it('is null without a ready forecast or a point for today', () => {
    assert.equal(todayForecast({ status: 'TOO_FEW' }, { completed_today: 1, open_now: 1 }, now), null);
    assert.equal(todayForecast({ ...forecast, forecast: [{ date: '2026-11-13', point: 1, lower: 1, upper: 1 }] }, { completed_today: 1, open_now: 1 }, now), null);
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
