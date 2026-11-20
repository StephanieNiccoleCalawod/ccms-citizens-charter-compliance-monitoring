// CC053 / CC054 Insights diagnostics (now consolidated into the main Dashboard): wording, colours, calls and source checks.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLE_LIST } from 'ccms-shared/roles';
import { getInsightsCell, getInsightsOverview, getOfficeLateRisk, retrainOfficeModels } from '../../src/lib/api/insights.js';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import {
  CHARTER_SHOW_OPTIONS,
  CHARTER_SORT_OPTIONS,
  buildDashboardTabs,
  buildLateRiskMilestones,
  buildServiceLateRateModel,
  buildUnusualEmptyState,
  classifyServiceCell,
  dashboardAuditCounts,
  deriveLateRiskItemMetrics,
  durationComparisonStatus,
  filterByFlag,
  filterCharterRows,
  filterNoActivityServices,
  filterScopedUnusual,
  forecastSentence,
  heatClass,
  heatLabel,
  highRiskSentence,
  isCharterFlagged,
  isCharterLowSample,
  mergeSentences,
  minutesText,
  sentenceText,
  sortCharterRows,
  sortQueueItems,
  sortRows,
  todayForecast,
} from '../../src/lib/ui/insights.js';

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
    assert.equal(sentenceText({ template: 5, params: { n: 2 } }, names), '2 transactions took more than three times the usual time');
    assert.equal(sentenceText({ template: 5, params: { n: 1 } }, names), '1 transaction took more than three times the usual time');
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
  it('classifies service cards, separates zero-activity services from Too few, applies All/Flagged/Too few filters, and enforces office scope', () => {
    assert.equal(classifyServiceCell({ completed: 4, late_rate: 100, too_few: true }), 'too_few');
    assert.equal(classifyServiceCell({ completed: 5, late_rate: 10, too_few: false }), 'on_track');
    assert.equal(classifyServiceCell({ completed: 10, late_rate: 15, too_few: false }), 'watch');
    assert.equal(classifyServiceCell({ completed: 10, late_rate: 25, too_few: false }), 'high');

    const offices = [
      { office_id: 'o1', office_name: 'Registrar', is_active: true },
      { office_id: 'o2', office_name: 'Cashier', is_active: true },
      { office_id: 'o3', office_name: 'Archived', is_active: false },
    ];
    const services = [
      { service_id: 's1', office_id: 'o1', service_code: 'REG-1', service_name: 'TOR Request', is_active: true },
      { service_id: 's2', office_id: 'o1', service_code: 'REG-2', service_name: 'Diploma', is_active: true },
      { service_id: 's3', office_id: 'o1', service_code: 'REG-3', service_name: 'Grades', is_active: true },
      { service_id: 's4', office_id: 'o2', service_code: 'CSH-1', service_name: 'Payment', is_active: true },
      { service_id: 's5', office_id: 'o3', service_code: 'ARC-1', service_name: 'Legacy', is_active: true },
    ];
    const heatmap = [
      { office_id: 'o1', service_id: 's1', service_code: 'REG-1', completed: 24, late: 9, late_rate: 37.5, too_few: false },
      { office_id: 'o1', service_id: 's2', service_code: 'REG-2', completed: 2, late: 1, late_rate: 50, too_few: true },
      { office_id: 'o2', service_id: 's4', service_code: 'CSH-1', completed: 10, late: 2, late_rate: 20, too_few: false },
    ];
    const officeNames = { offices: { o1: 'Registrar', o2: 'Cashier' }, services: { s1: 'TOR Request', s2: 'Diploma', s4: 'Payment' } };

    const allModel = buildServiceLateRateModel({ heatmap, offices, services, names: officeNames, scope: { kind: 'campus' }, filter: 'all' });
    assert.deepEqual(allModel.counts, { all: 3, flagged: 2, tooFew: 1 });
    assert.equal(allModel.officeRows.length, 2);
    assert.deepEqual(allModel.noActivityServices.map((s) => s.service_name), ['Grades']);

    const flaggedModel = buildServiceLateRateModel({ heatmap, offices, services, names: officeNames, scope: { kind: 'campus' }, filter: 'flagged' });
    assert.deepEqual(flaggedModel.officeRows.map((r) => r.cards.map((c) => c.service_code)), [['CSH-1'], ['REG-1']]);

    const fewModel = buildServiceLateRateModel({ heatmap, offices, services, names: officeNames, scope: { kind: 'campus' }, filter: 'too_few' });
    assert.deepEqual(fewModel.officeRows.map((r) => r.cards.map((c) => c.service_code)), [['REG-2']]);
    assert.equal(fewModel.officeRows[0].flagged_count, 1, 'office retains total flagged badge even under Too Few filter');
    assert.equal(fewModel.officeRows[0].low_volume, false);

    const lowOnlyModel = buildServiceLateRateModel({
      heatmap: [{ office_id: 'o2', service_id: 's4', service_code: 'CSH-1', completed: 2, late: 0, late_rate: 0, too_few: true }],
      offices,
      services,
      names: officeNames,
      scope: { kind: 'campus' },
      filter: 'all',
    });
    assert.equal(lowOnlyModel.officeRows[0].low_volume, true);
    assert.equal(filterNoActivityServices(lowOnlyModel.noActivityServices, 'tor').length, 1);
    assert.equal(filterNoActivityServices(lowOnlyModel.noActivityServices, 'zzz').length, 0);

    const scopedModel = buildServiceLateRateModel({ heatmap, offices, services, names: officeNames, scope: { kind: 'office', officeId: 'O1' }, filter: 'all' });
    assert.deepEqual(scopedModel.officeRows.map((r) => r.office_id), ['o1']);
    assert.deepEqual(scopedModel.noActivityServices.map((s) => s.service_name), ['Grades']);
  });

  it('filters and sorts Charter check rows numerically and respects low-sample & comparison status rules', () => {
    assert.deepEqual(CHARTER_SHOW_OPTIONS.map(([v]) => v), ['', 'flagged', 'too_few']);
    assert.deepEqual(CHARTER_SORT_OPTIONS.map(([v]) => v), ['late_rate', 'p90_minutes', 'completed', 'service_name']);

    const charterRows = [
      { office_id: 'o1', service_id: 's1', service_code: 'REG-1', completed: 24, late: 9, late_rate: 37.5, limit_minutes: 60, p90_minutes: 95, flags: ['LIMIT_OFTEN_MISSED'] },
      { office_id: 'o1', service_id: 's2', service_code: 'REG-2', completed: 100, late: 5, late_rate: 5, limit_minutes: 60, p90_minutes: 40, flags: [] },
      { office_id: 'o1', service_id: 's3', service_code: 'REG-3', completed: 3, late: 3, late_rate: 100, limit_minutes: 30, p90_minutes: 45, flags: ['NOT_ENOUGH_DATA'] },
      { office_id: 'o1', service_id: 's4', service_code: 'REG-4', completed: 20, late: 3, late_rate: 15, limit_minutes: 100, p90_minutes: null, flags: [] },
    ];
    const svcNames = { offices: { o1: 'Registrar' }, services: { s1: 'Transcript', s2: 'Clearance', s3: 'Appeal', s4: 'Diploma' } };

    assert.equal(isCharterLowSample(charterRows[2]), true);
    assert.equal(isCharterFlagged(charterRows[2]), false, 'low-sample 100% late row must not be judged flagged');
    assert.equal(isCharterFlagged(charterRows[0]), true);
    assert.equal(isCharterFlagged(charterRows[1]), false);
    assert.equal(durationComparisonStatus(charterRows[0]), 'over');
    assert.equal(durationComparisonStatus(charterRows[1]), 'within');
    assert.equal(durationComparisonStatus(charterRows[3]), null);

    assert.deepEqual(filterCharterRows(charterRows, 'flagged').map((r) => r.service_code), ['REG-1', 'REG-4']);
    assert.deepEqual(filterCharterRows(charterRows, 'too_few').map((r) => r.service_code), ['REG-3']);
    assert.deepEqual(sortCharterRows(charterRows, 'late_rate', svcNames).map((r) => r.service_code), ['REG-3', 'REG-1', 'REG-4', 'REG-2']);
    assert.deepEqual(sortCharterRows(charterRows, 'p90_minutes', svcNames).map((r) => r.service_code), ['REG-1', 'REG-3', 'REG-2', 'REG-4']);
    assert.deepEqual(sortCharterRows(charterRows, 'completed', svcNames).map((r) => r.service_code), ['REG-2', 'REG-1', 'REG-4', 'REG-3']);
    assert.deepEqual(sortCharterRows(charterRows, 'service_name', svcNames).map((r) => r.service_code), ['REG-3', 'REG-2', 'REG-4', 'REG-1']);
  });

  it('computes dynamic Dashboard tab badge counts from analytics responses and office scope', () => {
    const overview = {
      min_cell_completed: 5,
      heatmap: [
        { office_id: 'o1', service_id: 's1', completed: 24, late_rate: 37.5, too_few: false },
        { office_id: 'o1', service_id: 's2', completed: 3, late_rate: 100, too_few: true },
        { office_id: 'o2', service_id: 's3', completed: 20, late_rate: 5, too_few: false },
      ],
      charter: {
        services: [
          { office_id: 'o1', service_id: 's1', completed: 24, late_rate: 37.5, limit_minutes: 60, p90_minutes: 95, flags: ['LIMIT_OFTEN_MISSED'] },
          { office_id: 'o1', service_id: 's4', completed: 20, late_rate: 15, limit_minutes: 60, p90_minutes: 50, flags: [] },
          { office_id: 'o2', service_id: 's3', completed: 20, late_rate: 5, limit_minutes: 60, p90_minutes: 40, flags: [] },
        ],
        unusual: [
          { transaction_id: 'tx1', office_id: 'o1' },
          { transaction_id: 'tx2', office_id: 'o1' },
        ],
      },
    };
    const campusCounts = dashboardAuditCounts({ overview, scope: { kind: 'campus', officeId: null } });
    assert.deepEqual(campusCounts, { flaggedCount: 2, unusualCount: 2 });
    const office2Counts = dashboardAuditCounts({ overview, scope: { kind: 'office', officeId: 'O2' } });
    assert.deepEqual(office2Counts, { flaggedCount: 0, unusualCount: 0 });
    assert.equal(filterScopedUnusual(overview.charter.unusual, { kind: 'office', officeId: 'O2' }).length, 0);

    const campusTabs = buildDashboardTabs(campusCounts);
    assert.deepEqual(campusTabs.map((t) => t.label), ['Executive Overview', 'Office Performance Overview', 'Service Charter Compliance', 'Unusual Delays']);
    assert.equal(campusTabs[2].badge, '2 flagged');
    assert.equal(campusTabs[2].badgeTone, 'gold');
    assert.equal(campusTabs[3].badge, '2');
    assert.equal(campusTabs[3].badgeTone, 'gold');

    const zeroTabs = buildDashboardTabs(office2Counts);
    assert.equal(zeroTabs[2].badge, '0 flagged');
    assert.equal(zeroTabs[2].badgeTone, 'neutral');
    assert.equal(zeroTabs[3].badge, '0');
    assert.equal(zeroTabs[3].badgeTone, 'neutral');

    const emptyNone = buildUnusualEmptyState({ overview, scope: { kind: 'office', officeId: 'O2' } });
    assert.equal(emptyNone.reason, 'none_detected');
    assert.equal(emptyNone.minCompleted, 20);
    assert.equal(emptyNone.topService?.completed, 20);

    const emptyInsufficient = buildUnusualEmptyState({
      overview: {
        charter: {
          thresholds: { min_completed: 20 },
          services: [{ office_id: 'o1', service_id: 's1', service_code: 'PUP-REG-CRD-001', completed: 8 }],
        },
      },
      scope: { kind: 'campus', officeId: null },
    });
    assert.equal(emptyInsufficient.reason, 'insufficient_data');
    assert.equal(emptyInsufficient.topService?.completed, 8);
    assert.equal(emptyInsufficient.topService?.service_code, 'PUP-REG-CRD-001');

    const emptyZero = buildUnusualEmptyState({
      overview: { charter: { thresholds: { min_completed: 20 }, services: [] }, heatmap: [] },
    });
    assert.equal(emptyZero.reason, 'no_transactions');
    assert.equal(emptyZero.topService, null);

    const overdueMetrics = deriveLateRiskItemMetrics({
      level: 'HIGH',
      working_minutes_left: 0,
      share_used: 127.41,
      reason: '12741% of the time limit used',
    });
    assert.equal(overdueMetrics.isOverLimit, true);
    assert.equal(overdueMetrics.isSeverelyOverdue, true);
    assert.equal(overdueMetrics.barFillPct, 100);
    assert.match(overdueMetrics.consumptionLabel, /127\.4× limit/);

    const normalMetrics = deriveLateRiskItemMetrics({
      level: 'LOW',
      working_minutes_left: 75,
      share_used: 0.25,
      reason: '25% of the time limit used',
    });
    assert.equal(normalMetrics.isOverLimit, false);
    assert.equal(normalMetrics.barFillPct, 25);
    assert.equal(normalMetrics.limitText, '1 h 40 min');

    const sortedByMins = sortQueueItems([
      { tracking_no: 'B', level: 'HIGH', working_minutes_left: 50, probability: 0.9 },
      { tracking_no: 'A', level: 'LOW', working_minutes_left: 10, probability: 0.1 },
    ], 'minutes_asc');
    assert.deepEqual(sortedByMins.map((i) => i.tracking_no), ['A', 'B']);

    const highMilestones = buildLateRiskMilestones({
      level: 'HIGH',
      working_minutes_left: 0,
      share_used: 127.41,
      reason: 'Department Chairperson Endorsement',
    }, { formattedStart: '11/13/2026 9:14 AM' });
    assert.equal(highMilestones.length, 4);
    assert.deepEqual(highMilestones.map((m) => m.state), ['completed', 'completed', 'stalled', 'pending']);
    assert.match(highMilestones[2].subtitle, /Stalled/);

    const lowMilestones = buildLateRiskMilestones({
      level: 'LOW',
      working_minutes_left: 750,
      share_used: 0.52,
      reason: 'On track',
    }, { formattedStart: '11/17/2026 1:15 PM' });
    assert.equal(lowMilestones.length, 3);
    assert.deepEqual(lowMilestones.map((m) => m.state), ['completed', 'completed', 'on_track']);
    assert.match(lowMilestones[2].subtitle, /12 h 30 min \(750 min\) buffer remaining/);
  });
});

describe('page rules', () => {
  it('consolidates diagnostics into the main Dashboard (/) and removes the /insights route and sidebar item cleanly', () => {
    for (const role of ROLE_LIST) {
      assert.equal(appNavForRole(role, {}).some((i) => i.href === '/insights'), false, role);
    }
    assert.equal(existsSync(fileURLToPath(new URL('../../src/app/insights/page.js', import.meta.url))), false);
    assert.equal(existsSync(fileURLToPath(new URL('../../src/components/insights/InsightsPage.js', import.meta.url))), false);
    assert.doesNotMatch(read('src/app/page.js'), /<InsightsPage/);
  });

  it('integrates Late rate matrix, redesigned Charter check table, shared cell drilldown, Unusual cases tab, and 60s polling on Dashboard', () => {
    const dash = read('src/components/dashboard/DashboardAnalytics.js');
    const charter = read('src/components/dashboard/ServiceCharterPanel.js');
    const unusual = read('src/components/dashboard/UnusualCasesPanel.js');
    const matrix = read('src/components/dashboard/ServiceLateRateMatrix.js');
    const header = read('src/components/dashboard/DashboardHeader.js');
    const hook = read('src/lib/ui/useAnalytics.js');
    const lateRisk = read('src/components/analytics/LateRiskSection.js');
    assert.doesNotMatch(lateRisk, /<StatCard|Queue Urgency Breakdown|late-risk-detail-pane/);
    assert.match(lateRisk, /Ranked Open Transactions/);
    assert.match(lateRisk, /Charter Time Consumed/);
    assert.match(lateRisk, /Model Health Diagnostics/);
    assert.match(lateRisk, /Risk Score Thresholds/);
    assert.match(lateRisk, /LateRiskDetailDrawer/);
    assert.match(lateRisk, /Processing Milestones/);
    assert.match(lateRisk, /Time Limit Used/);
    assert.doesNotMatch(lateRisk, /SLA/);
    assert.match(dash, /<ServiceCharterPanel/);
    assert.match(dash, /<UnusualCasesPanel/);
    assert.match(charter, /<ServiceLateRateMatrix/);
    assert.match(charter, /<Card[^>]*id="charter"[^>]*as="section"/);
    assert.match(charter, /<DataTable/);
    assert.match(charter, /<StatusBadge/);
    assert.match(charter, /<ServiceCellDetail/);
    assert.match(charter, /role="progressbar"/);
    assert.match(charter, /data-testid="charter-filter"/);
    assert.match(charter, /data-testid="charter-sort"/);
    assert.match(unusual, /<Card[^>]*id="unusual"[^>]*as="section"/);
    assert.match(unusual, /<DataTable/);
    assert.match(unusual, /No Unusual Delays Found/);
    assert.match(unusual, /Highest single-service volume this period:/);
    assert.match(unusual, /<LoadingState>/);
    assert.match(unusual, /<StatusBanner variant="error"/);
    assert.match(matrix, /<ServiceCellDetail/);
    assert.match(matrix, /insights-heatmap/);
    assert.match(matrix, /heatmap-status-filter/);
    assert.match(matrix, /service-risk-legend/);
    assert.match(matrix, /no-services-period/);
    assert.match(header, /href="#charter"/);
    assert.doesNotMatch(dash, /<LateRiskSection/);
    assert.match(hook, /createPoller/);
    assert.match(hook, /POLL_INTERVAL_MS/);
    assert.match(header, /updatedLabel\(/);
  });

  it('avoids duplicate forecast fetches in DashboardAnalytics and opens Unusual Cases only when can_open', () => {
    const dash = read('src/components/dashboard/DashboardAnalytics.js');
    const unusual = read('src/components/dashboard/UnusualCasesPanel.js');
    assert.match(dash, /externalRun=\{models\.forecast\}/);
    assert.match(dash, /onRunChange=/);
    assert.match(unusual, /r\.can_open[\s\S]*?<Link href=\{`\/transactions\/\$\{encodeURIComponent\(r\.transaction_id\)\}`\}/);
  });
});
