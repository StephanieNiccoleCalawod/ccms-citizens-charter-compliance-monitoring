// CC052 Late-risk prediction: model unit tests + route/RBAC/cache/batching integration tests against a real DB.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ROLES } from 'ccms-shared';
import { POST as retrainRoute } from '../src/app/api/analytics/late-risk/retrain/route.js';
import { GET as lateRiskRoute } from '../src/app/api/analytics/late-risk/route.js';
import {
  MINIMUM_LATE_CASES,
  MODEL_THRESHOLDS,
  RULE_THRESHOLDS,
  classify,
  features,
  predict,
  sampleFraction,
  train,
} from '../src/modules/analytics/late-risk-model.js';
import { readLateRisk, trainLateRisk } from '../src/modules/analytics/late-risk.js';
import { OFFICE_A, OFFICE_B, SERVICE_A, USERS, call, req, resetData, setupTestEnv, tokens } from './helpers.js';

function syntheticRows(total, lateCount) {
  return Array.from({ length: total }, (_, i) => {
    const late = i < lateCount;
    const share = late ? 0.92 + (i % 4) * 0.05 : 0.20 + (i % 4) * 0.05;
    return {
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      late,
      values: features({
        share,
        classification: late ? 'COMPLEX' : 'SIMPLE',
        pace: late ? 1.1 : 0.45,
        load: late ? 1.4 : 0.8,
        onHold: late && i % 2 === 0,
        weekday: (i % 5) + 1,
      }),
    };
  });
}

describe('CC052 late-risk model (pure)', () => {
  it('returns INSUFFICIENT_DATA when training late cases are below 60', () => {
    const result = train(syntheticRows(90, 40));
    assert.equal(result.status, 'INSUFFICIENT_DATA');
    assert.ok(result.lateCases < MINIMUM_LATE_CASES);
    assert.equal(result.model, null);
    assert.equal(result.metrics, null);
  });

  it('trains deterministically with 20% holdout, standardized L2 logistic regression, and metrics', () => {
    const rows = syntheticRows(240, 110);
    const a = train(rows);
    const b = train(rows);
    assert.equal(a.status, 'TRAINED');
    assert.ok(a.lateCases >= MINIMUM_LATE_CASES);
    assert.ok(a.holdoutRows > 0 && a.trainingRows + a.holdoutRows === rows.length);
    assert.deepEqual(a.model, b.model);
    assert.deepEqual(a.metrics, b.metrics);
    assert.ok(a.metrics.accuracy > 0.8 && a.metrics.precision > 0.8 && a.metrics.recall > 0.8);

    const highProb = predict(a.model, features({ share: 0.98, classification: 'COMPLEX', pace: 1.2, load: 1.5, onHold: true, weekday: 2 })).probability;
    const lowProb = predict(a.model, features({ share: 0.15, classification: 'SIMPLE', pace: 0.4, load: 0.7, onHold: false, weekday: 2 })).probability;
    assert.ok(highProb >= MODEL_THRESHOLDS.high);
    assert.ok(lowProb < MODEL_THRESHOLDS.medium);
  });

  it('enforces exact trained and rule-based thresholds and deterministic sampleFraction', () => {
    assert.equal(classify(0.299, MODEL_THRESHOLDS), 'LOW');
    assert.equal(classify(0.30, MODEL_THRESHOLDS), 'MEDIUM');
    assert.equal(classify(0.599, MODEL_THRESHOLDS), 'MEDIUM');
    assert.equal(classify(0.60, MODEL_THRESHOLDS), 'HIGH');
    assert.equal(classify(0.49, RULE_THRESHOLDS), 'LOW');
    assert.equal(classify(0.50, RULE_THRESHOLDS), 'MEDIUM');
    assert.equal(classify(0.79, RULE_THRESHOLDS), 'MEDIUM');
    assert.equal(classify(0.80, RULE_THRESHOLDS), 'HIGH');
    const id = '11111111-1111-4111-8111-111111111111';
    assert.equal(sampleFraction(id), sampleFraction(id));
    assert.ok(sampleFraction(id) >= 0.10 && sampleFraction(id) < 1.0);
  });
});

describe('CC052 late-risk scoring, caching, batching & RBAC (DB)', () => {
  let env;
  before(async () => { env = await setupTestEnv(); });
  after(async () => { await env?.teardown(); });
  beforeEach(async () => {
    await resetData(env.ds);
    await env.ds.query('DELETE FROM late_risk_score_cache');
    await env.ds.query('DELETE FROM late_risk_runs');
  });

  async function seedTx({ id = randomUUID(), trackingNo, officeId = OFFICE_A, startedBy = USERS.staffA, status = 'IN_PROGRESS',
    startedAt = '2026-10-06T01:00:00Z', endedAt = null, isCompliant = null, elapsed = null, variance = null, classification = 'SIMPLE' }) {
    await env.ds.query(
      `INSERT INTO transactions (
         transaction_id, tracking_no, service_id, service_code, service_name,
         office_id, office_code, office_name, service_classification,
         standard_id, standard_duration_days, standard_duration_hours, standard_duration_minutes,
         client_type, client_reference, client_email, started_at, ended_at,
         started_by, started_by_name, started_by_position, status,
         elapsed_working_minutes, is_compliant, variance_minutes, held_minutes
       ) VALUES ($1,$2,$3,'PUP-OSAS-TOR-001','Transcript of Records',$4,'PUP-OSAS','Student Affairs',$5,
         $6,0,1,0,'STUDENT','2026-99999','secret@example.test',$7,$8,$9,'Secret Staff Name','Clerk','${status}',$10,$11,$12,0)`,
      [id, trackingNo, SERVICE_A, officeId, classification, randomUUID(), startedAt, endedAt, startedBy, elapsed, isCompliant, variance],
    );
    return id;
  }

  function fakeTiming(shareMap, { fail = false } = {}) {
    const batches = [];
    const fetcher = async (_url, init) => {
      if (fail) return new Response('{}', { status: 503 });
      const body = JSON.parse(init.body);
      batches.push(body.items.length);
      return new Response(JSON.stringify({
        items: body.items.map((item) => {
          const share = shareMap.get(item.start) ?? 0.2;
          return {
            at: item.end,
            used: Math.round(share * 100),
            limit: 100,
            onHold: Boolean(item.holdStarted),
            workingDays: ['2026-10-05', '2026-10-06'],
          };
        }),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return { batches, timing: { baseUrl: 'http://fake-core/api', key: 'k', fetcher } };
  }

  it('falls back to rule-based with <60 late cases, sorts HIGH first, caches for 60s, and promotes after expiry', async () => {
    const startHigh = '2026-10-06T01:00:00.000Z';
    const startLow = '2026-10-06T02:00:00.000Z';
    await seedTx({ trackingNo: 'PUP-OSAS-20261006-0001', startedAt: startLow });
    await seedTx({ trackingNo: 'PUP-OSAS-20261006-0002', startedAt: startHigh, startedBy: USERS.staffA2 });

    const shares = new Map([[startHigh, 0.85], [startLow, 0.40]]);
    const t1 = fakeTiming(shares);
    const atT0 = new Date('2026-10-06T03:00:00Z');
    const first = await readLateRisk(env.ds, OFFICE_A, { id: USERS.headA, role: ROLES.OFFICE_HEAD, officeId: OFFICE_A }, { now: atT0, timing: t1.timing });
    assert.equal(first.model.method, 'rule-based');
    assert.equal(first.stale, false);
    assert.deepEqual(first.items.map((i) => [i.tracking_no, i.level, i.rule_based]), [
      ['PUP-OSAS-20261006-0002', 'HIGH', true],
      ['PUP-OSAS-20261006-0001', 'LOW', true],
    ]);
    assert.equal(first.items[0].reason, '85% of the time limit used');
    assert.equal(first.items[0].main_reason_code, 'TIME_SHARE_HIGH');
    assert.equal(first.items[1].main_reason_code, 'TIME_SHARE_LOW');
    assert.equal(first.items[0].working_minutes_left, 15);
    assert.equal(t1.batches.length, 1);

    // Within 60s: uses cache without calling Core, even if share changes.
    shares.set(startLow, 0.90);
    const t2 = fakeTiming(shares);
    const cached = await readLateRisk(env.ds, OFFICE_A, { id: USERS.headA, role: ROLES.OFFICE_HEAD, officeId: OFFICE_A }, { now: new Date(atT0.getTime() + 30_000), timing: t2.timing });
    assert.equal(t2.batches.length, 0);
    assert.equal(cached.items[1].level, 'LOW');
    assert.equal(cached.items[1].main_reason_code, 'TIME_SHARE_LOW');

    // After 60s cache expires: recomputes and moves 0001 from LOW (40%) to HIGH (90%).
    const t3 = fakeTiming(shares);
    const refreshed = await readLateRisk(env.ds, OFFICE_A, { id: USERS.headA, role: ROLES.OFFICE_HEAD, officeId: OFFICE_A }, { now: new Date(atT0.getTime() + 61_000), timing: t3.timing });
    assert.equal(t3.batches.length, 1);
    assert.equal(refreshed.items.find((i) => i.tracking_no === 'PUP-OSAS-20261006-0001').level, 'HIGH');

    // Core down with existing cache -> returns stale: true with previous scores instead of 503.
    const tDown = fakeTiming(shares, { fail: true });
    const stale = await readLateRisk(env.ds, OFFICE_A, { id: USERS.headA, role: ROLES.OFFICE_HEAD, officeId: OFFICE_A }, { now: new Date(atT0.getTime() + 130_000), timing: tDown.timing });
    assert.equal(stale.stale, true);
    assert.equal(stale.as_of, new Date(atT0.getTime() + 61_000).toISOString());
    assert.equal(stale.items[0].main_reason_code, 'TIME_SHARE_HIGH');
  });

  it('batches Core calls in chunks of at most 60', async () => {
    const shares = new Map();
    for (let i = 0; i < 65; i += 1) {
      const s = new Date(Date.UTC(2026, 9, 6, 1, i, 0)).toISOString();
      shares.set(s, 0.25);
      await seedTx({ trackingNo: `PUP-OSAS-20261006-${String(i + 1).padStart(4, '0')}`, startedAt: s, startedBy: randomUUID() });
    }
    const timing = fakeTiming(shares);
    const res = await readLateRisk(env.ds, OFFICE_A, { id: USERS.adminId, role: ROLES.SUPER_ADMIN }, { now: new Date('2026-10-06T03:00:00Z'), timing: timing.timing });
    assert.equal(res.items.length, 65);
    assert.deepEqual(timing.batches.sort((a, b) => b - a), [60, 5]);
  });

  it('trains on DB history (>=60 late cases), strips PII/staff names, and gates probabilities to Super Admin only', async () => {
    const shares = new Map();
    for (let i = 0; i < 160; i += 1) {
      const late = i < 80;
      const s = new Date(Date.UTC(2026, 9, 1 + Math.floor(i / 20), 1, i % 20, 0)).toISOString();
      const e = new Date(Date.UTC(2026, 9, 1 + Math.floor(i / 20), 2, i % 20, 0)).toISOString();
      shares.set(s, late ? 0.95 : 0.20);
      await seedTx({
        trackingNo: `PUP-OSAS-20261001-${String(i + 1).padStart(4, '0')}`,
        startedAt: s,
        endedAt: e,
        status: 'COMPLETED',
        isCompliant: !late,
        elapsed: late ? 90 : 25,
        variance: late ? 30 : -35,
        classification: late ? 'COMPLEX' : 'SIMPLE',
      });
    }
    const openStart = '2026-10-20T01:00:00.000Z';
    shares.set(openStart, 0.95);
    await seedTx({ trackingNo: 'PUP-OSAS-20261020-0001', startedAt: openStart, classification: 'COMPLEX' });

    const timing = fakeTiming(shares);
    const trained = await trainLateRisk(env.ds, { now: new Date('2026-10-21T00:00:00Z'), timing: timing.timing });
    assert.equal(trained.running, false);
    assert.equal(trained.model.method, 'trained');
    assert.equal(trained.model.status, 'TRAINED');
    assert.ok(trained.model.late_cases >= 60);
    assert.ok(trained.model.metrics.accuracy > 0.7);

    // Executive: no probability, no staff name, no client PII, read-only can_open is true.
    const exec = await readLateRisk(env.ds, OFFICE_A, { id: USERS.execId, role: ROLES.EXECUTIVE }, { now: new Date('2026-10-20T03:00:00Z'), timing: timing.timing });
    assert.equal(exec.model.method, 'trained');
    assert.equal(exec.items[0].probability, undefined);
    assert.equal(exec.items[0].can_open, true);
    assert.equal(typeof exec.items[0].main_reason_code, 'string');
    assert.notEqual(exec.items[0].main_reason_code, 'MAIN_REASON_UNAVAILABLE');
    const serialized = JSON.stringify(exec);
    assert.ok(!serialized.includes('Secret Staff Name'));
    assert.ok(!serialized.includes('secret@example.test'));
    assert.ok(!serialized.includes('2026-99999'));

    // Office Staff: can_open is true only for own transactions, false for another staff member's transaction.
    const otherStaff = await readLateRisk(env.ds, OFFICE_A, { id: USERS.staffA2, role: ROLES.OFFICE_STAFF, officeId: OFFICE_A }, { now: new Date('2026-10-20T03:00:00Z'), timing: timing.timing });
    assert.equal(otherStaff.items[0].can_open, false);
    assert.equal(otherStaff.items[0].probability, undefined);
    const ownerStaff = await readLateRisk(env.ds, OFFICE_A, { id: USERS.staffA, role: ROLES.OFFICE_STAFF, officeId: OFFICE_A }, { now: new Date('2026-10-20T03:00:00Z'), timing: timing.timing });
    assert.equal(ownerStaff.items[0].can_open, true);

    // Super Admin receives numeric probability from the same scored cache.
    const admin = await readLateRisk(env.ds, OFFICE_A, { id: USERS.adminId, role: ROLES.SUPER_ADMIN }, { now: new Date('2026-10-20T03:00:00Z'), timing: timing.timing });
    assert.equal(typeof admin.items[0].probability, 'number');

    // >7 days stale run falls back to rule-based.
    const staleNow = new Date(Date.now() + 8 * 86_400_000);
    const staleRes = await readLateRisk(env.ds, OFFICE_A, { id: USERS.execId, role: ROLES.EXECUTIVE }, { now: staleNow, timing: timing.timing });
    assert.equal(staleRes.model.method, 'rule-based');
    assert.equal(staleRes.model.status, 'STALE');
  });

  it('enforces RBAC on GET /api/analytics/late-risk and POST /api/analytics/late-risk/retrain', async () => {
    assert.equal((await call(lateRiskRoute, req('GET', `/analytics/late-risk?officeId=${OFFICE_B}`, { token: tokens.officeHeadA }))).status, 403);
    assert.equal((await call(lateRiskRoute, req('GET', `/analytics/late-risk?officeId=${OFFICE_B}`, { token: tokens.officeStaffA }))).status, 403);
    assert.equal((await call(lateRiskRoute, req('GET', `/analytics/late-risk?officeId=${OFFICE_A}`))).status, 401);

    for (const token of [tokens.executive, tokens.officeHeadA, tokens.officeStaffA]) {
      assert.equal((await call(retrainRoute, req('POST', '/analytics/late-risk/retrain', { token }))).status, 403);
    }
    assert.equal((await call(retrainRoute, req('POST', '/analytics/late-risk/retrain'))).status, 401);
  });
});
