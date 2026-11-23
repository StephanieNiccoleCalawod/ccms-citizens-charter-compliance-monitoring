// TT5 / S8-09 (FE part): the Late-Risk and forecast screens show the real training run, or say plainly that rules are used.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { isTrainedModel, ruleBasedNote, showModelMetrics } from '../../src/lib/ui/model-status.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

// The shapes Operations returns in `model` (modelStatus in late-risk.js), one per state of the latest late_risk_runs row.
const trained = { method: 'trained', status: 'TRAINED', trained_at: '2026-11-18T19:30:39.298Z', rows: 701, training_rows: 569, late_cases: 97, excluded_rows: 0,
  metrics: { recall: 0.2, accuracy: 0.8484848484848485, precision: 0.5 }, thresholds: { medium: 0.3, high: 0.6 } };
const stale = { ...trained, method: 'rule-based', status: 'STALE', thresholds: { medium: 0.5, high: 0.8 } };
const insufficient = { method: 'rule-based', status: 'INSUFFICIENT_DATA', trained_at: null, rows: 1, training_rows: 1, late_cases: 1, metrics: null, thresholds: { medium: 0.5, high: 0.8 } };
const failed = { method: 'rule-based', status: 'FAILED', trained_at: null, rows: 0, training_rows: 0, late_cases: 0, metrics: null, thresholds: { medium: 0.5, high: 0.8 } };
const never = { method: 'rule-based', status: 'NOT_TRAINED', trained_at: null, rows: 0, training_rows: 0, late_cases: 0, metrics: null, thresholds: { medium: 0.5, high: 0.8 } };

describe('metrics only belong to a model that is scoring (AC2)', () => {
  it('a trained model shows its stored metrics', () => {
    assert.equal(isTrainedModel(trained), true);
    assert.equal(showModelMetrics(trained), true);
    assert.equal(ruleBasedNote(trained), null);
  });

  it('a stale model keeps its row in the database but no metric reaches the screen, because the rules are scoring', () => {
    assert.ok(stale.metrics, 'Operations still sends the old run\'s metrics');
    assert.equal(isTrainedModel(stale), false);
    assert.equal(showModelMetrics(stale), false);
    assert.match(ruleBasedNote(stale), /more than seven days old/i);
  });

  it('never trained, too little history and a failed run all say rule-based, with the reason, and show no metric', () => {
    for (const model of [never, insufficient, failed]) {
      assert.equal(showModelMetrics(model), false);
      assert.match(ruleBasedNote(model), /rule-based Citizen.s Charter time-limit thresholds/);
    }
    assert.match(ruleBasedNote(never), /No model has been trained yet/);
    assert.match(ruleBasedNote(insufficient), /Not enough history to train a model yet \(it needs at least 60 late cases\)/);
    assert.match(ruleBasedNote(failed), /last training attempt failed/);
  });

  it('a missing model object is not described as rule-based (the screen says the details are still loading)', () => {
    assert.equal(ruleBasedNote(null), null);
    assert.equal(showModelMetrics(undefined), false);
  });
});

describe('the screens read the stored run (AC1)', () => {
  const section = read('src/components/analytics/LateRiskSection.js');

  it('the Late-Risk summary prints the stored date, row count, late cases and metrics, and nothing it computes itself', () => {
    assert.match(section, /formatDateTime\(model\.trained_at\)/);
    assert.match(section, /model\.rows\.toLocaleString/);
    assert.match(section, /model\.late_cases\.toLocaleString/);
    for (const metric of ['accuracy', 'precision', 'recall']) assert.match(section, new RegExp(`percent\\(model\\.metrics\\.${metric}\\)`));
  });

  it('metrics and the rule-based sentence are decided by the shared helper', () => {
    assert.match(section, /showModelMetrics\(model\) \?/);
    assert.match(section, /ruleBasedNote\(model\)/);
    assert.doesNotMatch(section, /\{model\.metrics \?/, 'no screen path shows metrics just because the field exists');
  });

  it('the forecast About panel is only built from a SUCCESS run and prints the stored fields', () => {
    const forecast = read('src/components/dashboard/RequestForecastSection.js');
    assert.match(forecast, /if \(!run \|\| run\.status !== 'SUCCESS'\) return null;/);
    for (const field of ['run.model?.mae', 'run.historyWorkingDays', 'run.historicalTransactionCount', 'run.generatedAt']) assert.ok(forecast.includes(field), field);
    assert.match(forecast, /Not enough history yet \(needs 4 weeks\)/);
  });
});

describe('no client identity reaches the model (AC4, FE side)', () => {
  it('the Late-Risk screens never display or send a client name, email, reference or registry number', () => {
    const section = read('src/components/analytics/LateRiskSection.js');
    assert.doesNotMatch(section, /client_(name|email|reference|type)|registry|student_number|full_name/i);
  });

  it('the late-risk and forecast requests carry only an office (and service) ID', () => {
    const api = read('src/lib/api/insights.js');
    assert.match(api, /getOfficeLateRisk = \(officeId, fetcher = apiFetch\) => fetcher\(`\$\{OPERATIONS_ANALYTICS_API\}\/late-risk\$\{toQuery\(\{ officeId \}\)\}`\)/);
    assert.match(api, /body: \{ officeId \}/);
  });
});
