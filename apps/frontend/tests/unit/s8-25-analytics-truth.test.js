// S8-25 (FE): the late-risk screen tells the truth. No button reports an action that was not stored (F8-01), an overdue item says how
// long it is overdue in working time (or just "Overdue" when the service has not sent the figure), and nothing shows 219700% of a limit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { deriveLateRiskItemMetrics } from '../../src/lib/ui/insights.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// The shape the service sends today for an open transaction that is far past its limit (real: share_used 2197, no minutes left).
const realOverdue = { transaction_id: 't1', tracking_no: 'PUP-LIB-20261113-9001', service_name: 'Service', level: 'HIGH', reason: '219700% of the time limit used', share_used: 2197, working_minutes_left: 0, rule_based: false, can_open: true };

describe('overdue items say how long they are overdue (AC2)', () => {
  it('with the overdue working time from the service: "Overdue by 2 h 15 min (working time)"', () => {
    const m = deriveLateRiskItemMetrics({ ...realOverdue, overdue_working_minutes: 135 });
    assert.equal(m.isOverLimit, true);
    assert.equal(m.overdueMinutes, 135);
    assert.equal(m.overdueText, 'Overdue by 2 h 15 min (working time)');
    assert.equal(m.consumptionLabel, 'Overdue by 2 h 15 min (working time)');
    assert.equal(m.pctUsed, null);
    assert.equal(m.barFillPct, 100);
  });

  it('with the limit and the elapsed working time instead, it works the overdue time out', () => {
    const m = deriveLateRiskItemMetrics({ ...realOverdue, limit_minutes: 480, elapsed_working_minutes: 615 });
    assert.equal(m.overdueMinutes, 135);
    assert.equal(m.overdueText, 'Overdue by 2 h 15 min (working time)');
    assert.equal(m.elapsedSubtext, '+2 h 15 min over limit');
  });

  it('with neither (the service does not send it yet) it says "Overdue" and invents no figure', () => {
    const m = deriveLateRiskItemMetrics(realOverdue);
    assert.equal(m.overdueMinutes, null);
    assert.equal(m.overdueText, 'Overdue (past the Charter time limit)');
    for (const text of [m.consumptionLabel, m.elapsedText, m.elapsedSubtext, m.overdueText]) assert.doesNotMatch(String(text), /%|×|\d{3,}/, `no huge number in "${text}"`);
  });

  it('a transaction still within its limit keeps its percentage and its time left (percentages only where they help)', () => {
    const m = deriveLateRiskItemMetrics({ level: 'LOW', share_used: 0.25, working_minutes_left: 360, reason: '25% of the time limit used' });
    assert.equal(m.isOverLimit, false);
    assert.equal(m.overdueText, null);
    assert.equal(m.pctUsed, 25);
    assert.equal(m.consumptionLabel, '25% of limit used');
    assert.equal(m.limitMinutes, 480, 'the limit is worked out from the time left and the share used');
  });

  it('the list and the dialog use the overdue wording and real time units, not "min" counts or a "Breached" tag', () => {
    const source = read('src/components/analytics/LateRiskSection.js');
    assert.match(source, /\{m\.isOverLimit \? m\.overdueText : m\.pctUsed !== null/, 'the list column');
    assert.match(source, /\{breached \? 'Overdue' : minutesText\(mins\)\}/, 'the Time Left column');
    assert.match(source, /m\.isOverLimit \? 'Overdue' : minutesText\(minsLeft\)/, 'the dialog');
    assert.doesNotMatch(source, />s*Breacheds*<|'Breached'|buffer`/);
  });
});

describe('no button reports an action that was not stored (AC1, F8-01)', () => {
  const code = strip(read('src/components/analytics/LateRiskSection.js'));

  it('there is no escalation: no Escalate button, no confirmation, no "Escalation logged" or "notification queued" message', () => {
    assert.doesNotMatch(code, /escalat/i);
    assert.doesNotMatch(code, /Escalation logged|notification queued|Confirm Escalation|ConfirmDialog/);
  });

  it('the list action opens the detail and is called Review (or Inspect), the dialog\'s one button opens the real transaction record', () => {
    assert.match(code, /actionMode = isHigh \? 'review' : 'inspect'/);
    assert.match(code, /<span>\{isHigh \? 'Review' : 'Inspect'\}<\/span>/);
    assert.match(code, /router\.push\(`\/transactions\/\$\{encodeURIComponent\(item\.transaction_id\)\}`\)/);
    assert.match(code, /Open Transaction Record/);
  });

  it('every success message on the screen comes after a request that was awaited (training), never straight from a click', () => {
    const notices = [...code.matchAll(/setNotice\(([^)]*)\)/g)].map((m) => m[1]).filter((arg) => arg !== "''");
    assert.ok(notices.length >= 1 && notices.every((arg) => /Training|trained/i.test(arg)), `success notices: ${notices.join(' | ')}`);
    const call = code.indexOf("await apiFetch(`${API}/retrain`, { method: 'POST' })");
    assert.ok(call > 0 && call < code.indexOf('Training completed'), 'the training message is set only after the POST to /retrain was awaited');
  });
});

describe('the states of the screen (AC3, AC4)', () => {
  const code = read('src/components/analytics/LateRiskSection.js');

  it('an office with nothing open shows an empty state, not sample data', () => {
    assert.match(code, /emptyMessage="No open transactions in this office\."/);
    assert.doesNotMatch(code, /sample|mock|placeholder data/i);
  });

  it('rule-based and no-model scoring say so, with the reason, and show no metric (TT5)', () => {
    assert.match(code, /ruleBasedNote\(model\)/);
    assert.match(code, /showModelMetrics\(model\) \?/);
  });

  it('an Executive never sees who processed a transaction, and an office role starts on its own office', () => {
    assert.match(code, /'Protected \(Executive view\)'/);
    assert.match(code, /useState\(user\?\.officeId \?\? ''\)/);
  });
});

describe('the milestones never repeat the service\'s huge percentage text', () => {
  it('an overdue item\'s "Initial Document & Deadline Check" says overdue, not "27600% of the time limit used"', async () => {
    const { buildLateRiskMilestones } = await import('../../src/lib/ui/insights.js');
    const steps = buildLateRiskMilestones({ ...realOverdue, reason: '27600% of the time limit used', overdue_working_minutes: 135 });
    assert.equal(steps.find((s) => s.id === 'verified').subtitle, 'Overdue by 2 h 15 min (working time)');
    for (const step of steps) assert.doesNotMatch(`${step.title} ${step.subtitle}`, /\d{3,}%/, step.id);
    const unknown = buildLateRiskMilestones({ ...realOverdue, reason: '27600% of the time limit used' });
    assert.equal(unknown.find((s) => s.id === 'verified').subtitle, 'Overdue (past the Charter time limit)');
  });
});
