import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { calculationView, combineCalculations, parameterLabel } from '../../src/lib/ui/calculation.js';
import {
  accuracyLine, forecastChartData, forecastCsv, forecastCsvName, forecastDayCards, forecastHeadline, forecastTableRows, notEnoughHistoryMessage,
} from '../../src/lib/ui/forecast.js';
import { dashboardKpis, dashboardTrendPulse } from '../../src/lib/api/analytics.js';

const read = (path) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

const calc = (overrides = {}) => ({
  what_it_shows: 'The percentage of judged requests finished on time.',
  how_it_is_computed: ['Count on-time and late completions.', 'Divide and multiply by 100.'],
  data_used: { record_count: 120, period_from: '2026-11-01', period_to: '2026-11-30', date_basis: 'Manila end date', source: 'analytics_transactions' },
  method: 'on_time / judged * 100',
  last_run_at: '2026-11-24T06:00:00Z',
  parameters: { minimum_cell_completed: 5, nested: { a: 1 } },
  ...overrides,
});

describe('S8-46 calculation panel wording', () => {
  it('has the three parts with the real count, written-out dates and the last run in Manila time', () => {
    const view = calculationView(calc());
    assert.equal(view.shows, 'The percentage of judged requests finished on time.');
    assert.equal(view.steps.length, 2);
    assert.deepEqual(view.data.slice(0, 2), [
      { label: 'Records used', value: '120' },
      { label: 'Dates', value: 'November 1–30, 2026' },
    ]);
    assert.equal(view.data.find((r) => r.label === 'Records come from').value, 'Completed and open transactions kept for analytics');
    assert.equal(view.lastRun, '11/24/2026 2:00 PM');
    assert.deepEqual(view.parameters, [{ label: 'Minimum cell completed', value: '5' }]);
  });

  it('never invents a count or a date range', () => {
    const view = calculationView(calc({ data_used: { record_count: null, period_from: null, period_to: null } }));
    assert.equal(view.data[0].value, 'Not counted for this figure');
    assert.equal(view.data[1].value, 'No dates recorded');
  });

  it('gives nothing for a missing or empty entry, so the panel says so', () => {
    assert.equal(calculationView(null), null);
    assert.equal(calculationView({}), null);
    assert.equal(parameterLabel('p90_minutes'), 'P90 minutes');
  });

  it('adds the records of many parts and spans their dates', () => {
    const parts = [
      calc({ data_used: { record_count: 10, period_from: '2026-10-01', period_to: '2026-10-31' } }),
      calc({ data_used: { record_count: 5, period_from: '2026-11-01', period_to: '2026-11-30' } }),
    ];
    const one = combineCalculations(parts);
    assert.equal(one.data_used.record_count, 15);
    assert.equal(one.data_used.period_from, '2026-10-01');
    assert.equal(one.data_used.period_to, '2026-11-30');
    assert.equal(combineCalculations([]), null);
  });

  it('is on the KPI cards, the trend, the heatmap, the late-risk card and every chart frame', () => {
    const overview = {
      pulse: { on_time_rate: 90, results: 10, open_now: 2 },
      calculations: { on_time_rate: calc(), pending: calc({ what_it_shows: 'Open now.' }), monthly: [{ total: calc() }] },
    };
    const kpis = dashboardKpis({ overview, lateRisk: { state: 'ok', value: { items: [], calculations: { late_risk: calc({ what_it_shows: 'Late risk.' }) } } } });
    assert.equal(kpis.every((k) => k.calculation), true);
    assert.equal(dashboardTrendPulse(overview).calculation.data_used.record_count, 120);
    assert.match(read('components/charts/ChartCard.js'), /calculation !== undefined/);
    assert.match(read('components/ui/StatCard.js'), /CalculationInfo/);
    for (const file of ['dashboard/ServiceLateRateMatrix.js', 'dashboard/ServiceCharterPanel.js', 'dashboard/UnusualCasesPanel.js', 'ratings/RatingsSection.js', 'dashboard/RequestForecastSection.js']) {
      assert.match(read(`components/${file}`), /CalculationInfo/, file);
    }
  });

  it('keeps model names inside the panel: no screen title or label names the method', () => {
    for (const file of ['dashboard/RequestForecastSection.js', 'dashboard/LateRiskPanel.js', 'dashboard/ComplianceTrendChart.js']) {
      assert.doesNotMatch(read(`components/${file}`), /Holt-Winters|logistic regression|seasonal naive|\bIQR\b/i, file);
    }
  });

  it('is an accessible dialog that returns focus to its button', () => {
    const source = read('components/analytics/CalculationInfo.js');
    assert.match(source, /aria-haspopup="dialog"/);
    assert.match(source, /returnFocusRef=\{buttonRef\}/);
    assert.match(source, /How is \$\{subject\} calculated\?/);
  });
});

const run = (extra = {}) => ({
  status: 'SUCCESS',
  generatedAt: '2026-11-24T00:30:00.000Z',
  model: { name: 'HOLT_WINTERS_ADDITIVE', mae: 3 },
  history: [{ date: '2026-11-20', count: 11 }, { date: '2026-11-23', count: 9 }],
  forecast: [
    { date: '2026-11-24', point: 12.4, lower: 10, upper: 15 },
    { date: '2026-11-25', point: 13, lower: 10, upper: 16 },
    { date: '2026-11-27', point: 12, lower: 9, upper: 14 },
    { date: '2026-11-30', point: 14, lower: 11, upper: 17 },
    { date: '2026-12-01', point: 13, lower: 10, upper: 16 },
  ],
  ...extra,
});

describe('S8-48 expected requests next week', () => {
  it('writes the headline with the total, the likely range and the written-out dates', () => {
    const h = forecastHeadline(run());
    assert.equal(h.total, 64);
    assert.equal(h.low, 50);
    assert.equal(h.high, 78);
    assert.equal(h.text, 'Expected requests next week: about 64 (likely between 50 and 78), November 24 – December 1, 2026.');
  });

  it('has no headline without a forecast', () => {
    assert.equal(forecastHeadline(run({ status: 'NOT_ENOUGH_HISTORY' })), null);
    assert.equal(forecastHeadline(run({ forecast: [] })), null);
  });

  it('shows one card per working day and "Office closed" for a weekday the calendar left out', () => {
    const cards = forecastDayCards(run());
    assert.deepEqual(cards.map((c) => [c.weekday, c.closed]), [
      ['Tuesday', false], ['Wednesday', false], ['Thursday', true], ['Friday', false], ['Monday', false], ['Tuesday', false],
    ]);
    assert.equal(cards[0].dateText, 'November 24, 2026');
    assert.equal(cards[0].expected, 12);
    assert.equal(cards[2].expected, null);
  });

  it('states the average error in plain words', () => {
    assert.equal(accuracyLine(run()), 'Over the last 5 working days this method was off by about 3 requests per day on average.');
    assert.equal(accuracyLine(run({ model: { mae: 1 } })), 'Over the last 5 working days this method was off by about 1 request per day on average.');
    assert.equal(accuracyLine(run({ model: { mae: null } })), null);
  });

  it('says "Not enough history yet" with the real numbers instead of a forecast', () => {
    assert.match(notEnoughHistoryMessage({ status: 'NOT_ENOUGH_HISTORY', historyWorkingDays: 12 }), /^Not enough history yet\. .*20 working days.*12 days are recorded so far\.$/);
    assert.match(notEnoughHistoryMessage({ status: 'TOO_FEW' }), /^Not enough history yet for this service\. .*40 requests/);
    assert.equal(notEnoughHistoryMessage(run()), null);
  });

  it('marks the future on the chart and the screen uses them', () => {
    const source = read('components/dashboard/RequestForecastSection.js');
    const chart = read('components/dashboard/RequestForecastChart.js');
    assert.match(source, /forecast-headline/);
    assert.match(source, /forecast-day-cards/);
    assert.match(source, /label="Recorded"/);
    assert.match(chart, /strokeDasharray="5 4"/);
    assert.match(chart, /todayLabel/);
    assert.doesNotMatch(source, /slice\(5\)/);
    const data = forecastChartData(run());
    assert.equal(data[0].label, 'Nov 20');
    assert.equal(data[0].fullDate, 'November 20, 2026');
  });
});

describe('S8-47 the table lists every record behind the chart', () => {
  it('lists every recorded day the model used, then the expected days', () => {
    const rows = forecastTableRows(run());
    assert.equal(rows.length, 2 + 5);
    assert.deepEqual(rows.slice(0, 2).map((r) => r.kind), ['Recorded', 'Recorded']);
    assert.deepEqual(rows.slice(2).map((r) => r.kind), ['Expected', 'Expected', 'Expected', 'Expected', 'Expected']);
    assert.equal(rows[0].dateText, 'Nov 20, 2026');
    assert.equal(rows[2].range, '10–15');
  });

  it('downloads the same rows as the table: MM/DD/YYYY, plain headings, BOM, one header row', () => {
    const csv = forecastCsv(run());
    const lines = csv.trimEnd().split('\r\n');
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.equal(lines[0], '﻿Date,Actual requests,Expected requests,Likely range,Type');
    assert.equal(lines.length, 1 + forecastTableRows(run()).length);
    assert.equal(lines[1], '11/20/2026,11,,,Recorded');
    assert.equal(lines[3], '11/24/2026,,12,10–15,Expected');
  });

  it('names the file for the office and the day', () => {
    assert.equal(forecastCsvName("Registrar's Office", '2026-11-24'), 'CCCMS_Expected_Requests_Registrar_s_Office_11242026.csv');
  });

  it('pages a long table without losing rows and has Show more and Download CSV', () => {
    const source = read('components/dashboard/RequestForecastSection.js');
    assert.match(source, /Show more/);
    assert.match(source, /Download CSV/);
    assert.match(source, /forecastTableRows\(run\)/);
  });
});
