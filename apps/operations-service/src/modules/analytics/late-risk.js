import { Errors, ROLES, endOfManilaDay, fromManila, manilaWeekday } from 'ccms-shared';
import { canReadTransaction } from '../transaction/access.js';
import { coreBaseUrl } from '../transaction/core-client.js';
import { classify, features, MODEL_THRESHOLDS, predict, RULE_THRESHOLDS, sampleFraction, train } from './late-risk-model.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
const CACHE_TTL = MINUTE;
const RUN_LOCK = 1794552000;
const isOpen = (row) => row.status === 'IN_PROGRESS' || row.status === 'ON_HOLD';
const duration = (row) => row.standard_duration_hours * 60 + row.standard_duration_minutes;
const instant = (value) => new Date(value).getTime();
const iso = (value) => new Date(value).toISOString();
const shareOf = (used, limit) => limit > 0 ? used / limit : Number(used > 0);

async function history(db, officeId, asOf) {
  return db.query(`SELECT t.transaction_id, t.tracking_no, t.service_id, t.service_name, t.office_id, t.service_classification,
    t.standard_duration_days, t.standard_duration_hours, t.standard_duration_minutes, t.started_at, t.ended_at, t.status,
    t.elapsed_working_minutes, t.variance_minutes, t.is_compliant, t.held_minutes, t.hold_started_at, t.started_by,
    COALESCE(t.ended_at, events.closed_at) AS closed_at, COALESCE(events.hold_events, '[]'::jsonb) AS hold_events
    FROM transactions t
    LEFT JOIN LATERAL (
      SELECT max(created_at) FILTER (WHERE event_type IN ('TRANSACTION_CANCELLED','TRANSACTION_CANCELED','TRANSACTION_AUTO_CLOSED')) AS closed_at,
        jsonb_agg(jsonb_build_array(event_type, created_at) ORDER BY event_version)
          FILTER (WHERE event_type IN ('TRANSACTION_HELD','TRANSACTION_RESUMED')) AS hold_events
      FROM analytics_outbox WHERE transaction_id = t.transaction_id AND created_at <= $2
    ) events ON true
    WHERE ($1::uuid IS NULL OR t.office_id = $1) AND t.started_at <= $2
    ORDER BY t.transaction_id`, [officeId, asOf]);
}

function holdIntervals(row) {
  const spans = [];
  let start = null;
  for (const [event, at] of row.hold_events) {
    if (event === 'TRANSACTION_HELD') start = at;
    else if (start) {
      spans.push([iso(start), iso(at)]);
      start = null;
    }
  }
  return spans;
}

function timingInput(row, end) {
  return { start: iso(row.started_at), end: iso(end), days: row.standard_duration_days, minutes: duration(row) };
}

async function measure(jobs, { baseUrl = coreBaseUrl(), key = process.env.SERVICE_KEY, fetcher = fetch } = {}) {
  if (!jobs.length) return [];
  if (!baseUrl || !key) throw Errors.unavailable('The working-time calendar is unavailable', 'LATE_RISK_CALENDAR_UNAVAILABLE');
  const grouped = Map.groupBy(jobs, (job) => job.row.office_id);
  const batches = [];
  for (const [office, items] of grouped) {
    for (let index = 0; index < items.length; index += 60) batches.push([office, items.slice(index, index + 60)]);
  }
  const results = [];
  for (let index = 0; index < batches.length; index += 6) {
    const measured = await Promise.all(batches.slice(index, index + 6).map(async ([officeId, batch]) => {
      const response = await fetcher(`${baseUrl}/internal/late-risk-times`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-service-key': key },
        body: JSON.stringify({ officeId, items: batch.map((job) => job.input) }), signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw Errors.unavailable('The working-time calendar is unavailable', 'LATE_RISK_CALENDAR_UNAVAILABLE');
      const { items } = await response.json();
      if (!Array.isArray(items) || items.length !== batch.length) throw new Error('Invalid working-time batch');
      return items.map((times, item) => ({ row: batch[item].row, times }));
    }));
    results.push(...measured.flat());
  }
  return results;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : 1;
}

function countBefore(sorted, at) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const middle = Math.floor((lo + hi) / 2);
    if (sorted[middle] <= at) lo = middle + 1;
    else hi = middle;
  }
  return lo;
}

function officeHistory(rows) {
  const entries = rows.filter((row) => row.closed_at || isOpen(row));
  const starts = entries.map((row) => instant(row.started_at)).sort((a, b) => a - b);
  const ends = entries.filter((row) => row.closed_at).map((row) => instant(row.closed_at)).sort((a, b) => a - b);
  const completed = rows.filter((row) => row.status === 'COMPLETED' && row.ended_at && row.elapsed_working_minutes !== null &&
      (!row.standard_duration_days || row.variance_minutes !== null))
    .map((row) => ({ service: row.service_id, at: instant(row.ended_at), value: shareOf(row.elapsed_working_minutes,
      row.standard_duration_days ? row.elapsed_working_minutes - row.variance_minutes : duration(row)) }));
  return { starts, ends, completed, counts: new Map() };
}

function modelInput(context, row, times) {
  const at = instant(times.at);
  const past = context.completed.filter((item) => item.at < at);
  const service = past.filter((item) => item.service === row.service_id);
  const openAt = (time) => countBefore(context.starts, time) - countBefore(context.ends, time);
  const loadCounts = times.workingDays.map((date) => {
    if (!context.counts.has(date)) context.counts.set(date, openAt(endOfManilaDay(fromManila(date)).getTime()));
    return context.counts.get(date);
  });
  const average = loadCounts.reduce((sum, value) => sum + value, 0) / (loadCounts.length || 1);
  return { share: shareOf(times.used, times.limit), classification: row.service_classification,
    pace: median((service.length >= 10 ? service : past).map((item) => item.value)),
    load: openAt(at) / (average || 1), onHold: times.onHold,
    weekday: manilaWeekday(times.at) };
}

const latestRun = async (db) => (await db.query(`SELECT run_id, created_at, status, rows, training_rows, holdout_rows, late_cases,
  metrics, coefficients, excluded_rows FROM late_risk_runs ORDER BY created_at DESC, run_id DESC LIMIT 1`))[0] ?? null;

function modelStatus(run, now) {
  const trained = run?.status === 'TRAINED' && run.coefficients?.version === 1 && now - instant(run.created_at) <= 7 * DAY;
  return { method: trained ? 'trained' : 'rule-based', status: !run ? 'NOT_TRAINED' : trained ? 'TRAINED' : run.status === 'TRAINED' ? 'STALE' : run.status,
    trained_at: run?.status === 'TRAINED' ? iso(run.created_at) : null, rows: run?.rows ?? 0, training_rows: run?.training_rows ?? 0,
    late_cases: run?.late_cases ?? 0, excluded_rows: run?.excluded_rows ?? 0, metrics: run?.metrics ?? null,
    thresholds: trained ? MODEL_THRESHOLDS : RULE_THRESHOLDS };
}

export async function trainLateRisk(db, { now = new Date(), timing } = {}) {
  return db.transaction(async (manager) => {
    const [lock] = await manager.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired', [RUN_LOCK]);
    if (!lock.acquired) return { running: true, model: modelStatus(await latestRun(manager), now.getTime()) };
    const rows = await history(manager, null, now);
    const contexts = new Map([...Map.groupBy(rows, (row) => row.office_id)].map(([office, records]) => [office, officeHistory(records)]));
    const candidates = rows.filter((row) => row.status === 'COMPLETED' && row.ended_at && instant(row.ended_at) <= now.getTime() &&
      row.is_compliant !== null && row.elapsed_working_minutes !== null);
    const jobs = candidates.flatMap((row) => {
      const holds = holdIntervals(row);
      // Older records may only have the accumulated hold minutes. A sample with unknown hold timing would leak later information.
      if (row.held_minutes > 0 && !holds.length) return [];
      return [{ row, input: { ...timingInput(row, row.ended_at), elapsed: row.elapsed_working_minutes, fraction: sampleFraction(row.transaction_id), holds } }];
    });
    let result;
    try {
      const measured = await measure(jobs, timing);
      result = train(measured.map(({ row, times }) => ({ id: row.transaction_id, late: !row.is_compliant,
        values: features(modelInput(contexts.get(row.office_id), row, times)) })));
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'Late-risk training failed', error: error?.code ?? error?.name }));
      result = { status: 'FAILED', rows: 0, trainingRows: 0, holdoutRows: 0, lateCases: 0, metrics: null, model: null };
    }
    const [run] = await manager.query(`INSERT INTO late_risk_runs (status, rows, training_rows, holdout_rows, late_cases, excluded_rows, metrics, coefficients)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) RETURNING *`, [result.status, result.rows, result.trainingRows, result.holdoutRows,
      result.lateCases, candidates.length - jobs.length, result.metrics ? JSON.stringify(result.metrics) : null, result.model ? JSON.stringify(result.model) : null]);
    return { running: false, model: modelStatus(run, Date.now()) };
  });
}

function score(row, times, context, model) {
  const input = modelInput(context, row, times);
  const shareReason = `${Math.round(input.share * 100)}% of the time limit used`;
  const reasons = [shareReason, 'Simple service', 'Complex service', 'Highly technical service',
    'Usual service or office pace', 'Office busier than usual', 'On hold', ...Array(7).fill('Working weekday')];
  const prediction = model ? predict(model, features(input)) : null;
  const strongest = prediction?.contributions.reduce((best, value, index, values) => value > (values[best] ?? 0) ? index : best, -1) ?? -1;
  return { transaction_id: row.transaction_id, tracking_no: row.tracking_no, service_name: row.service_name, started_by: row.started_by,
    level: classify(prediction?.probability ?? input.share, prediction ? MODEL_THRESHOLDS : RULE_THRESHOLDS),
    probability: prediction?.probability ?? null, reason: strongest === -1 ? shareReason : reasons[strongest],
    working_minutes_left: Math.max(0, times.limit - times.used), rule_based: !prediction };
}

const riskOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export async function readLateRisk(db, officeId, user, { now = new Date(), timing } = {}) {
  const [run, [cache]] = await Promise.all([latestRun(db), db.query('SELECT scored_at, run_id, payload FROM late_risk_score_cache WHERE office_id = $1', [officeId])]);
  const status = modelStatus(run, now.getTime());
  const runId = run?.run_id ?? null;
  const present = (payload, at, stale) => ({ ...payload, as_of: iso(at), stale,
    items: payload.items.map(({ started_by, probability, ...item }) => ({ ...item,
      can_open: canReadTransaction(user, { office_id: officeId, started_by }),
      ...(user.role === ROLES.SUPER_ADMIN ? { probability } : {}),
    })) });
  if (cache?.run_id === runId && cache.payload.model.method === status.method && now.getTime() - instant(cache.scored_at) < CACHE_TTL) {
    return present(cache.payload, cache.scored_at, false);
  }
  const rows = await history(db, officeId, now);
  const jobs = rows.filter(isOpen).map((row) => ({ row, input: { ...timingInput(row, now), heldMinutes: row.held_minutes,
    holdStarted: row.hold_started_at ? iso(row.hold_started_at) : null } }));
  let measured;
  try {
    measured = await measure(jobs, timing);
  } catch {
    if (cache) return present(cache.payload, cache.scored_at, true);
    throw Errors.unavailable('Working time is unavailable and no previous scores are saved', 'LATE_RISK_CALENDAR_UNAVAILABLE');
  }
  const context = officeHistory(rows);
  const model = status.method === 'trained' ? run.coefficients : null;
  const items = measured.map(({ row, times }) => score(row, times, context, model));
  items.sort((a, b) => riskOrder[a.level] - riskOrder[b.level] || (b.probability ?? 0) - (a.probability ?? 0) ||
    a.working_minutes_left - b.working_minutes_left || a.tracking_no.localeCompare(b.tracking_no));
  const payload = { model: status, items };
  await db.query(`INSERT INTO late_risk_score_cache (office_id, scored_at, run_id, payload) VALUES ($1,$2,$3,$4::jsonb)
    ON CONFLICT (office_id) DO UPDATE SET scored_at = EXCLUDED.scored_at, run_id = EXCLUDED.run_id, payload = EXCLUDED.payload
    WHERE late_risk_score_cache.scored_at < EXCLUDED.scored_at`, [officeId, now, runId, JSON.stringify(payload)]);
  return present(payload, now, false);
}
