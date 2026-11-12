import { fromManila, toManilaDate } from 'ccms-shared';
import { computeCompliance, timeLimitMinutes } from '../transaction/compliance.js';
import {
  AUGUST_PEAK, CLIENT_MIX, CLIENT_MIX_TOLERANCE_POINTS, DEFAULTS, LATE_COUNT_700, LATE_RATE, MISS_REASONS_BY_TYPE,
  MONTH_TARGETS, MONTH_TARGET_DAYS, OFFICE_SHARES, OPEN_MAX, OPEN_MIN, OPEN_WORKING_DAYS, PATTERN_CODES, PATTERN_RATES,
  REGISTRY_MISS_SHARE, RISK_LEVELS, RUSH_WEEKS, SEED_SEQUENCE, SHARE_RANGES, TOP_FIFTH_SHARE, UNUSED_SHARE, officeCodeOf,
  patternServiceCode,
} from './config.js';
import { apportion, balancedMatrix, createRandom, mapLimit, sha256 } from './random.js';

// Sprint 6 TT1 planner. Pure planning over the inputs (catalogue, accounts, registry, calendar) plus Core's working-time
// engine for every time computation; it writes nothing. The dry run and the import call exactly this function, so the
// dry run shows the plan the import writes. Results are NOT set by hand: every completed row's on-time/late result comes
// from computeCompliance(), the same code Operations uses after a real Complete, against Core's effective calendar.

export class PlanError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.name = 'PlanError';
    this.diagnostics = diagnostics;
  }
}

const MIN = 60_000;
const dateOf = (value) => toManilaDate(value);
const monthOf = (date) => date.slice(0, 7);
const inRange = (date, { from, to }) => date >= from && date <= to;

/** Late-count bounds for a volume: the plan's 110-125 for 700, the 15-18% rate otherwise (both always checked). */
export function lateBounds(volume) {
  const min = Math.ceil(LATE_RATE.min * volume);
  const max = Math.floor(LATE_RATE.max * volume);
  if (volume === DEFAULTS.volume) return { min: Math.max(min, LATE_COUNT_700.min), max: Math.min(max, LATE_COUNT_700.max), target: Math.round(LATE_RATE.target * volume) };
  return { min, max, target: Math.round(LATE_RATE.target * volume) };
}

/** Completed rows per month: the plan's month density (per calendar day), scaled to the period and volume. */
export function monthTargets({ from, to, volume }) {
  const perDay = new Map(Object.entries(MONTH_TARGETS).map(([month, count]) => [month, count / MONTH_TARGET_DAYS[month]]));
  const fallback = DEFAULTS.volume / 129;
  const weights = new Map();
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const month = new Date(t).toISOString().slice(0, 7);
    weights.set(month, (weights.get(month) ?? 0) + (perDay.get(month) ?? fallback));
  }
  return apportion(volume, weights);
}

function standardOn(standardsByService, serviceId, date) {
  const list = standardsByService.get(serviceId) ?? [];
  let found = null;
  for (const s of list) if (s.effective_from <= date && (!s.effective_to || s.effective_to >= date) && (!found || s.effective_from > found.effective_from)) found = s;
  return found;
}

/** Resolves offices, services, pattern services and accounts; collects every missing prerequisite. */
export function resolveCatalogue({ catalogue, accounts, options, problems }) {
  const standardsByService = new Map();
  for (const s of catalogue.standards) {
    if (!standardsByService.has(s.service_id)) standardsByService.set(s.service_id, []);
    standardsByService.get(s.service_id).push(s);
  }
  const offices = [];
  for (const [key, share] of OFFICE_SHARES) {
    const code = officeCodeOf(key);
    const matches = catalogue.offices.filter((o) => o.office_code === code);
    if (matches.length !== 1 || !matches[0].is_active) {
      problems.push(`office ${code}: ${matches.length === 0 ? 'missing' : matches.length > 1 ? 'ambiguous' : 'inactive'}`);
      continue;
    }
    const office = matches[0];
    // Active PUP-* services of this office with a standard in force for the whole period (seed plan 1 and 5).
    const candidates = catalogue.services
      .filter((s) => s.office_id === office.office_id && s.is_active && s.service_code.startsWith(`${code}-`))
      .sort((a, b) => a.service_code.localeCompare(b.service_code));
    const services = [];
    let withoutStandard = 0;
    for (const s of candidates) {
      if (!standardOn(standardsByService, s.service_id, options.from) || !standardOn(standardsByService, s.service_id, options.asOf)) {
        withoutStandard += 1;
        continue;
      }
      if (!Array.isArray(s.allowed_client_types) || s.allowed_client_types.length === 0) {
        problems.push(`service ${s.service_code}: unreadable allowed client types`);
        continue;
      }
      services.push(s);
    }
    if (!services.length) problems.push(`office ${code}: no active service with a standard in force for the whole period`);
    const staff = accounts.get(office.office_id) ?? [];
    if (!staff.length) problems.push(`office ${code}: no active Office Head or Office Staff account (register the accounts first)`);
    offices.push({ key, code, share, office, services, staff, withoutStandard });
  }
  const patterns = {};
  const resolvePattern = (planCode) => {
    const code = patternServiceCode(planCode);
    const all = catalogue.services.filter((s) => s.service_code === code);
    const usable = offices.flatMap((o) => o.services).filter((s) => s.service_code === code);
    if (all.length !== 1 || usable.length !== 1) {
      problems.push(`pattern service ${code}: ${all.length === 0 ? 'missing' : all.length > 1 ? 'ambiguous' : 'inactive or without a standard in force'}`);
      return null;
    }
    return usable[0].service_id;
  };
  patterns.rush = PATTERN_CODES.credentialRush.map(resolvePattern);
  patterns.assembly = resolvePattern(PATTERN_CODES.assembly);
  patterns.facilities = PATTERN_CODES.assemblyFacilities.map(resolvePattern);
  patterns.generous = resolvePattern(PATTERN_CODES.generousStandard);
  patterns.chronic = resolvePattern(PATTERN_CODES.chronicDelay);
  return { offices, patterns, standardsByService };
}

/** Ranks each office's services in a fixed random order: the top fifth gets ~60%, about a third get none (plan 1). */
function rankServices(office, patternIds, seed) {
  const random = createRandom(seed, `rank:${office.code}`);
  const order = random.shuffle(office.services.map((s) => s.service_id));
  const n = order.length;
  const top = Math.max(1, Math.round(n / 5));
  let unused = n >= 3 || n === 2 ? Math.round(n * UNUSED_SHARE) : 0;
  unused = Math.min(unused, n - top);
  // Pattern services must be used: move any that fell into the unused tail just above it.
  let used = order.slice(0, n - unused);
  let idle = order.slice(n - unused);
  for (const id of idle.filter((serviceId) => patternIds.has(serviceId))) {
    const swap = [...used].reverse().find((candidate) => !patternIds.has(candidate));
    if (!swap) continue;
    used = used.map((x) => (x === swap ? id : x));
    idle = idle.map((x) => (x === id ? swap : x));
  }
  const weights = new Map();
  const rest = used.length - top;
  used.forEach((id, index) => {
    if (index < top) weights.set(id, (rest > 0 ? TOP_FIFTH_SHARE : 1) * ((top - index + 1) / ((top * (top + 3)) / 2)));
    else weights.set(id, (1 - TOP_FIFTH_SHARE) * (1 / (index - top + 2)) / [...Array(rest).keys()].reduce((acc, k) => acc + 1 / (k + 2), 0));
  });
  return { used, idle, top: used.slice(0, top), weights };
}

/** Day weight within a month (season shape, plan 8, and the rush weeks, plan 1). */
function dayWeight(officeKey, date) {
  let weight = 1;
  if (AUGUST_PEAK.offices.includes(officeKey) && inRange(date, AUGUST_PEAK)) weight *= AUGUST_PEAK.dayWeight;
  if (officeKey === 'REG' && inRange(date, RUSH_WEEKS)) weight *= 1.6;
  return weight;
}

/** Service weight in a segment (plan 1 and 2 volume patterns). */
function serviceWeight(base, serviceId, { month, segment }, patterns) {
  let weight = base;
  if (serviceId === patterns.assembly && month.endsWith('-10')) weight *= PATTERN_RATES.assemblyOctoberFactor;
  if (patterns.facilities.includes(serviceId) && month.endsWith('-10')) weight *= PATTERN_RATES.facilitiesOctoberFactor;
  if (patterns.rush.includes(serviceId) && segment === 'rush') weight *= PATTERN_RATES.rushServiceFactor;
  return weight;
}

function pickRegistry(pool, date, random, { expired = false } = {}) {
  const fits = pool.filter((p) => (expired ? p.valid_until && p.valid_until < date : !p.valid_until || p.valid_until >= date));
  return fits.length ? fits[random.int(fits.length)] : null;
}

/** Client type quotas honour each service's allowed types (CC047); returns the counts actually used. */
function assignClientTypes(rows, total, services, random) {
  const quota = apportion(total, Object.fromEntries(CLIENT_MIX));
  const target = new Map(quota);
  for (const row of random.shuffle(rows)) {
    const allowed = services.get(row.service_id).allowed_client_types;
    let best = null;
    for (const [type] of CLIENT_MIX) {
      if (!allowed.includes(type)) continue;
      const ratio = target.get(type) ? quota.get(type) / target.get(type) : -1;
      if (best === null || ratio > best.ratio) best = { type, ratio };
    }
    row.client_type = best.type;
    quota.set(best.type, quota.get(best.type) - 1);
  }
  const counts = Object.fromEntries(CLIENT_MIX.map(([type]) => [type, rows.filter((r) => r.client_type === type).length]));
  return counts;
}

function assignRegistry(rows, registry, random, problems) {
  const pools = { STUDENT: registry.filter((r) => r.status === 'ENROLLED'), ALUMNI: registry.filter((r) => r.status === 'ALUMNI') };
  const lookedUp = rows.filter((r) => r.client_type === 'STUDENT' || r.client_type === 'ALUMNI');
  for (const row of rows) Object.assign(row, { registry_status: 'NONE', registry_student_number: null, registry_miss_reason: null });
  if (!lookedUp.length) return { misses: 0 };
  for (const type of ['STUDENT', 'ALUMNI']) {
    if (lookedUp.some((r) => r.client_type === type) && !pools[type].length) {
      problems.push(`registry: no ${type === 'STUDENT' ? 'ENROLLED' : 'ALUMNI'} records (run the CC043 demo registry import first)`);
    }
  }
  const missCount = Math.round(lookedUp.length * REGISTRY_MISS_SHARE);
  const misses = new Set(random.shuffle(lookedUp).slice(0, missCount));
  let index = 0;
  for (const row of lookedUp) {
    const date = dateOf(row.started_at);
    if (misses.has(row)) {
      const reasons = MISS_REASONS_BY_TYPE[row.client_type];
      const reason = reasons[index % reasons.length];
      index += 1;
      const expired = reason === 'RETURNING_STUDENT' ? pickRegistry(pools.STUDENT, date, random, { expired: true }) : null;
      Object.assign(row, expired
        ? { registry_status: 'EXPIRED', registry_student_number: expired.student_number, registry_miss_reason: reason }
        : { registry_status: 'NOT_FOUND', registry_student_number: null, registry_miss_reason: reason });
      continue;
    }
    const person = pickRegistry(pools[row.client_type], date, random);
    if (!person) {
      problems.push(`registry: no valid ${row.client_type === 'STUDENT' ? 'ENROLLED' : 'ALUMNI'} record on ${date}`);
      continue;
    }
    Object.assign(row, { registry_status: 'MATCHED', registry_student_number: person.student_number });
  }
  return { misses: misses.size };
}

function createCoreMemo(core) {
  const cache = new Map();
  const memo = (name, fn) => (args) => {
    const key = `${name}:${JSON.stringify(args)}`;
    if (!cache.has(key)) cache.set(key, fn(args).catch((err) => { cache.delete(key); throw err; }));
    return cache.get(key);
  };
  return {
    workingMinutes: memo('wm', (a) => core.workingMinutes(a)),
    deadline: memo('dl', (a) => core.deadline(a)),
    addWorkingMinutes: memo('awm', (a) => core.addWorkingMinutes(a)),
  };
}

/** The working-minute length of the time limit from a start (the same arithmetic computeCompliance uses). */
async function limitOf(engine, row) {
  const start = new Date(row.started_at);
  if (row.standard_duration_days === 0) return timeLimitMinutes({ hours: row.standard_duration_hours, minutes: row.standard_duration_minutes });
  const firstDeadline = await engine.deadline({ start, workingDays: row.standard_duration_days, officeId: row.office_id, heldMinutes: 0 });
  const deadline = await engine.addWorkingMinutes({ datetime: new Date(firstDeadline), minutes: timeLimitMinutes({ hours: row.standard_duration_hours, minutes: row.standard_duration_minutes }), officeId: row.office_id });
  return engine.workingMinutes({ start, end: new Date(deadline), officeId: row.office_id });
}

const elapsedTo = (engine, row, end) => (end.getTime() > new Date(row.started_at).getTime()
  ? engine.workingMinutes({ start: new Date(row.started_at), end, officeId: row.office_id })
  : Promise.resolve(0));

/** Sets ended_at from the intended share of the limit, then computes the real result with the Operations engine. */
async function completeRow(engine, row, asOfStart) {
  const limit = row.limit_minutes ?? (row.limit_minutes = await limitOf(engine, row));
  let target = Math.max(1, Math.round(row.share * limit));
  let end = new Date(await engine.addWorkingMinutes({ datetime: new Date(row.started_at), minutes: target, officeId: row.office_id }));
  if (end >= asOfStart) {
    // Completed history must end before the as-of date: shorten (and record it) rather than invent a future end.
    const available = (await elapsedTo(engine, row, new Date(asOfStart.getTime() - MIN))) - 1;
    if (available < 1) throw new PlanError('A completed row has no working time before the as-of date', {});
    target = Math.max(1, Math.min(target, available));
    end = new Date(await engine.addWorkingMinutes({ datetime: new Date(row.started_at), minutes: target, officeId: row.office_id }));
    row.clamped = true;
  }
  row.ended_at = end.toISOString();
  const result = await computeCompliance(engine, {
    startedAt: row.started_at, endedAt: row.ended_at, heldMinutes: 0, officeId: row.office_id,
    days: row.standard_duration_days, hours: row.standard_duration_hours, minutes: row.standard_duration_minutes,
  });
  row.elapsed_working_minutes = result.elapsed;
  row.is_compliant = result.isCompliant;
  row.variance_minutes = result.variance;
}

/** Systematic selection of late rows inside a group: exact expected counts, deterministic, keeps time trends. */
function markLate(rows, probabilityOf, random) {
  let cumulative = random.next();
  for (const row of rows) {
    const before = Math.floor(cumulative);
    cumulative += probabilityOf(row);
    row.intent_late = Math.floor(cumulative) > before;
  }
}

function setShare(row, random) {
  if (row.group === 'generous') row.share = random.between(...SHARE_RANGES.generous);
  else if (row.unusual) row.share = SHARE_RANGES.usual * random.between(...SHARE_RANGES.unusualFactor);
  else row.share = row.intent_late ? random.between(...SHARE_RANGES.late) : random.between(...SHARE_RANGES.onTime);
}

function startInstant(date, windows, random) {
  const usable = windows.filter((w) => w.close - w.open >= 30);
  const pool = usable.length ? usable : windows;
  const window = pool[random.int(pool.length)];
  const latest = Math.max(window.open, window.close - 30);
  const minute = window.open + random.int(latest - window.open + 1);
  return fromManila(date, `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
}

/** Canonical business data of a planned or stored row (never IDs, audit timestamps or delivery metadata). */
export function businessRecord(row) {
  return [
    row.tracking_no, row.office_id, row.service_id, row.standard_id, row.client_type, row.registry_status,
    row.registry_student_number ?? null, row.registry_miss_reason ?? null, new Date(row.started_at).toISOString(),
    row.ended_at ? new Date(row.ended_at).toISOString() : null, row.started_by, row.ended_by ?? null, row.status,
    row.elapsed_working_minutes ?? null, row.is_compliant ?? null, row.variance_minutes ?? null,
  ];
}
export const planDigest = (rows) => sha256(JSON.stringify([...rows].map(businessRecord).sort((a, b) => a[0].localeCompare(b[0]))));

/**
 * Builds the whole plan. options: { from, to, volume, seed, asOf, openTarget }. inputs: { catalogue, accounts, registry,
 * calendar, busyStaff }. core: a Core client (workingMinutes, deadline, addWorkingMinutes). Throws PlanError with
 * aggregate diagnostics when a prerequisite or a plan target cannot be met; never changes a mapping or quota to fit.
 */
export async function buildPlan({ inputs, options, core, concurrency = 6 }) {
  const problems = [];
  const asOfStart = fromManila(options.asOf);
  if (!(options.to < options.asOf)) problems.push('--as-of must be after --to');
  const { offices, patterns, standardsByService } = resolveCatalogue({ catalogue: inputs.catalogue, accounts: inputs.accounts, options, problems });
  if (problems.length) throw new PlanError('Prerequisites are missing', { problems });
  const servicesById = new Map(offices.flatMap((o) => o.services.map((s) => [s.service_id, { ...s, office: o }])));
  const patternIds = new Set([...patterns.rush, patterns.assembly, ...patterns.facilities, patterns.generous, patterns.chronic]);
  const engine = createCoreMemo(core);

  // ---- 1. Volume: month x office (both margins exact) ----
  const months = [...monthTargets(options).entries()].filter(([, n]) => n > 0);
  const officeTotals = apportion(options.volume, Object.fromEntries(offices.map((o) => [o.key, o.share])));
  const seasonal = (office, month) => {
    let w = 1;
    if (month.endsWith('-08') && AUGUST_PEAK.offices.includes(office.key)) w *= 1.35;
    if (month.endsWith('-10') && ['REG', 'OSAS', 'ADMIN'].includes(office.key)) w *= 1.15;
    const days = [...(inputs.calendar.get(office.office.office_id)?.keys() ?? [])].filter((d) => monthOf(d) === month && inRange(d, options));
    return days.length ? w : 0;
  };
  let matrix;
  try {
    matrix = balancedMatrix(
      offices.map((o) => officeTotals.get(o.key)),
      months.map(([, n]) => n),
      offices.map((o) => months.map(([month, n]) => n * o.share * seasonal(o, month))),
    );
  } catch (err) {
    throw new PlanError(err.message, { problems: [err.message] });
  }

  // ---- 2. Days, segments, services, start times ----
  const completed = [];
  offices.forEach((office, oi) => {
    const ranking = rankServices(office, patternIds, options.seed);
    office.ranking = ranking;
    const calendar = inputs.calendar.get(office.office.office_id);
    months.forEach(([month], mi) => {
      const count = matrix[oi][mi];
      if (!count) return;
      const days = [...calendar.keys()].filter((d) => monthOf(d) === month && inRange(d, options)).sort();
      const perDay = apportion(count, new Map(days.map((d) => [d, dayWeight(office.key, d)])));
      const random = createRandom(options.seed, `cell:${office.code}:${month}`);
      const segments = new Map();
      for (const day of days) {
        const segment = inRange(day, RUSH_WEEKS) ? 'rush' : 'base';
        if (!segments.has(segment)) segments.set(segment, []);
        for (let i = 0; i < perDay.get(day); i += 1) segments.get(segment).push(day);
      }
      for (const [segment, slots] of [...segments.entries()].sort()) {
        const weights = new Map(ranking.used.map((id) => [id, serviceWeight(ranking.weights.get(id), id, { month, segment }, patterns)]));
        const counts = apportion(slots.length, weights);
        const services = random.shuffle([...counts.entries()].flatMap(([id, n]) => Array(n).fill(id)));
        slots.forEach((day, index) => {
          const service = servicesById.get(services[index]);
          const standard = standardOn(standardsByService, service.service_id, day);
          completed.push({
            office_id: office.office.office_id, office_code: office.code, office_name: office.office.office_name, office_key: office.key,
            service_id: service.service_id, service_code: service.service_code, service_name: service.service_name,
            service_classification: service.classification, standard_id: standard.standard_id,
            standard_duration_days: standard.duration_days, standard_duration_hours: standard.duration_hours,
            standard_duration_minutes: standard.duration_minutes,
            started_at: startInstant(day, calendar.get(day), random).toISOString(), segment, status: 'COMPLETED',
          });
        });
      }
    });
  });
  completed.sort((a, b) => a.started_at.localeCompare(b.started_at) || a.service_code.localeCompare(b.service_code) || a.office_code.localeCompare(b.office_code));

  // ---- 3. Clients, registry, staff ----
  const clientCounts = assignClientTypes(completed, completed.length, servicesById, createRandom(options.seed, 'clients'));
  const registryOutcome = assignRegistry(completed, inputs.registry, createRandom(options.seed, 'registry'), problems);
  const staffRandom = createRandom(options.seed, 'staff');
  for (const row of completed) {
    const staff = offices.find((o) => o.code === row.office_code).staff;
    const starter = staff[staffRandom.int(staff.length)];
    const ender = staff.length > 1 && staffRandom.next() < 0.2 ? staff[(staff.indexOf(starter) + 1) % staff.length] : starter;
    Object.assign(row, { started_by: starter.id, started_by_name: starter.name, started_by_position: starter.position, ended_by: ender.id });
  }

  // ---- 4. Lateness intent (plan 1 and patterns 1, 3, 4, 5, 6) ----
  const bounds = lateBounds(options.volume);
  const span = Math.max(1, (Date.parse(options.to) - Date.parse(options.from)) / 86_400_000);
  const acadRate = (row) => PATTERN_RATES.acadFirstLate + (PATTERN_RATES.acadLastLate - PATTERN_RATES.acadFirstLate)
    * Math.min(1, Math.max(0, (Date.parse(dateOf(row.started_at)) - Date.parse(options.from)) / 86_400_000 / span));
  for (const row of completed) {
    if (row.service_id === patterns.generous) row.group = 'generous';
    else if (patterns.rush.includes(row.service_id) && row.segment === 'rush') row.group = 'rush';
    else if (row.service_id === patterns.chronic) row.group = 'chronic';
    else if (row.office_key === 'ACAD') row.group = 'acad';
    else row.group = 'other';
  }
  const perService = new Map();
  for (const row of completed) perService.set(row.service_id, (perService.get(row.service_id) ?? 0) + 1);
  const unusualRandom = createRandom(options.seed, 'unusual');
  // Unusual cases (pattern 6): services with at least 20 completed rows (the CC054 minimum), started before the last day.
  const unusualPool = completed.filter((r) => r.group === 'other' && perService.get(r.service_id) >= PATTERN_RATES.unusualMinRowsPerService && dateOf(r.started_at) < options.to);
  const unusualServices = unusualRandom.shuffle([...new Set(unusualPool.map((r) => r.service_id))].sort());
  for (const serviceId of unusualServices.slice(0, PATTERN_RATES.unusualCount)) {
    const candidates = unusualPool.filter((r) => r.service_id === serviceId);
    const row = candidates[unusualRandom.int(candidates.length)];
    if (row) Object.assign(row, { unusual: true, intent_late: true });
  }
  const groups = { rush: PATTERN_RATES.rushLate, chronic: PATTERN_RATES.chronicLate, generous: 0 };
  const expectedPattern = completed.reduce((acc, r) => acc + (r.group === 'acad' ? acadRate(r) : r.group in groups ? groups[r.group] : 0), 0);
  const others = completed.filter((r) => r.group === 'other' && !r.unusual);
  const unusualCount = completed.filter((r) => r.unusual).length;
  const baseRate = Math.min(0.6, Math.max(0, (bounds.target - expectedPattern - unusualCount) / Math.max(1, others.length)));
  const lateRandom = createRandom(options.seed, 'late');
  for (const group of ['rush', 'chronic', 'acad', 'generous']) {
    markLate(completed.filter((r) => r.group === group), (r) => (group === 'acad' ? acadRate(r) : groups[group]), lateRandom);
  }
  markLate(others, () => baseRate, lateRandom);
  const shareRandom = createRandom(options.seed, 'share');
  for (const row of completed) setShare(row, shareRandom);

  // ---- 5. End times and real results (Core calendar + Operations compliance engine) ----
  await mapLimit(completed, concurrency, (row) => completeRow(engine, row, asOfStart));
  const adjustRandom = createRandom(options.seed, 'adjust');
  for (let pass = 0; pass < 4; pass += 1) {
    const late = completed.filter((r) => r.is_compliant === false).length;
    if (late >= bounds.min && late <= bounds.max) break;
    const wantLate = late < bounds.min;
    const flip = adjustRandom.shuffle(others.filter((r) => r.is_compliant === !wantLate)).slice(0, Math.abs(bounds.target - late));
    for (const row of flip) {
      row.intent_late = wantLate;
      row.share = wantLate ? adjustRandom.between(...SHARE_RANGES.late) : adjustRandom.between(...SHARE_RANGES.onTime);
      row.adjusted = true;
    }
    await mapLimit(flip, concurrency, (row) => completeRow(engine, row, asOfStart));
  }

  // ---- 6. Open rows "today" (40-60, five preceding working days, Low/Medium/High coverage) ----
  const open = await planOpenRows({ offices, inputs, options, engine, servicesById, standardsByService, asOfStart, problems, concurrency });

  // ---- 7. Tracking numbers 9001+ per office per Manila date ----
  const byDay = new Map();
  for (const row of [...completed, ...open]) {
    const key = `${row.office_code}|${dateOf(row.started_at)}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(row);
  }
  for (const [key, rows] of byDay) {
    rows.sort((a, b) => a.started_at.localeCompare(b.started_at) || a.service_code.localeCompare(b.service_code) || a.status.localeCompare(b.status));
    if (rows.length > SEED_SEQUENCE.last - SEED_SEQUENCE.first + 1) problems.push(`${key}: more than 999 rows on one day`);
    rows.forEach((row, index) => {
      row.tracking_no = `${row.office_code}-${dateOf(row.started_at).replaceAll('-', '')}-${SEED_SEQUENCE.first + index}`;
    });
  }

  const diagnostics = summarize({ completed, open, offices, patterns, options, bounds, clientCounts, registryOutcome, months });
  checkTargets(diagnostics, bounds, problems);
  if (problems.length) throw new PlanError('The plan does not meet its targets', { problems, ...diagnostics });
  return { completed, open, diagnostics, digest: planDigest([...completed, ...open]) };
}

/** The 5 working days before the as-of date for an office (its own effective calendar). */
function precedingWorkingDays(calendar, asOf) {
  return [...calendar.keys()].filter((d) => d < asOf).sort().slice(-OPEN_WORKING_DAYS);
}

async function planOpenRows({ offices, inputs, options, engine, servicesById, standardsByService, asOfStart, problems, concurrency }) {
  const random = createRandom(options.seed, 'open');
  const available = new Map(offices.map((o) => [o.key, o.staff.filter((a) => !inputs.busyStaff.has(a.id))]));
  const totalAvailable = [...available.values()].reduce((acc, list) => acc + list.length, 0);
  const n = Math.min(options.openTarget, OPEN_MAX, totalAvailable);
  if (n < OPEN_MIN) {
    problems.push(`open rows: only ${totalAvailable} staff account(s) without a live open transaction; the plan needs ${OPEN_MIN}-${OPEN_MAX} open rows and one open transaction per staff account`);
    return [];
  }
  // Office split by the plan shares, capped by each office's free staff; the rest goes to offices with free staff.
  const wanted = apportion(n, Object.fromEntries(offices.map((o) => [o.key, o.share])));
  const counts = new Map(offices.map((o) => [o.key, Math.min(wanted.get(o.key), available.get(o.key).length)]));
  let left = n - [...counts.values()].reduce((a, b) => a + b, 0);
  for (const o of [...offices].sort((a, b) => b.share - a.share)) {
    const spare = available.get(o.key).length - counts.get(o.key);
    const add = Math.min(spare, left);
    counts.set(o.key, counts.get(o.key) + add);
    left -= add;
  }
  const levels = ['HIGH', 'MEDIUM', 'LOW'];
  const slots = [];
  for (const office of offices) {
    const staff = random.shuffle(available.get(office.key)).slice(0, counts.get(office.key));
    staff.forEach((account) => slots.push({ office, account, level: levels[slots.length % 3] }));
  }
  const levelOf = (share) => (share >= RISK_LEVELS.HIGH ? 'HIGH' : share >= RISK_LEVELS.MEDIUM ? 'MEDIUM' : 'LOW');
  const rows = await mapLimit(slots, concurrency, async (slot, index) => {
    const slotRandom = createRandom(options.seed, `open-slot:${index}`);
    const calendar = inputs.calendar.get(slot.office.office.office_id);
    const days = precedingWorkingDays(calendar, options.asOf);
    if (!days.length) return null;
    const services = slotRandom.shuffle(slot.office.ranking.used);
    const dayOrder = slot.level === 'LOW' ? [...days].reverse() : slot.level === 'HIGH' ? days : slotRandom.shuffle(days);
    let fallback = null;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const service = servicesById.get(services[attempt % services.length]);
      const day = dayOrder[Math.floor(attempt / services.length) % dayOrder.length];
      const standard = standardOn(standardsByService, service.service_id, day);
      const startedAt = startInstant(day, calendar.get(day), slotRandom);
      const row = {
        office_id: slot.office.office.office_id, office_code: slot.office.code, office_name: slot.office.office.office_name, office_key: slot.office.key,
        service_id: service.service_id, service_code: service.service_code, service_name: service.service_name,
        service_classification: service.classification, standard_id: standard.standard_id,
        standard_duration_days: standard.duration_days, standard_duration_hours: standard.duration_hours,
        standard_duration_minutes: standard.duration_minutes, started_at: startedAt.toISOString(), status: 'IN_PROGRESS',
        started_by: slot.account.id, started_by_name: slot.account.name, started_by_position: slot.account.position, ended_by: null,
      };
      const limit = await limitOf(engine, row);
      const used = await elapsedTo(engine, row, asOfStart);
      row.risk_share = limit > 0 ? used / limit : 1;
      row.risk_level = levelOf(row.risk_share);
      fallback ??= row;
      if (row.risk_level === slot.level) return row;
    }
    return fallback;
  });
  const result = rows.filter(Boolean);
  if (result.length < OPEN_MIN) problems.push(`open rows: only ${result.length} could be placed in the ${OPEN_WORKING_DAYS} working days before ${options.asOf}`);
  assignClientTypes(result, result.length, servicesById, createRandom(options.seed, 'open-clients'));
  assignRegistry(result, inputs.registry, createRandom(options.seed, 'open-registry'), problems);
  return result.sort((a, b) => a.started_at.localeCompare(b.started_at) || a.service_code.localeCompare(b.service_code));
}

const pct = (part, whole) => (whole ? Math.round((1000 * part) / whole) / 10 : null);
const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Aggregate diagnostics only: counts, rates and service codes. No names, student numbers or account ids. */
export function summarize({ completed, open, offices, patterns, options, bounds, clientCounts, registryOutcome, months }) {
  const late = completed.filter((r) => r.is_compliant === false);
  const byMonthOffice = {};
  for (const [month] of months) byMonthOffice[month] = Object.fromEntries(offices.map((o) => [o.key, 0]));
  for (const row of completed) byMonthOffice[monthOf(dateOf(row.started_at))][row.office_key] += 1;
  const concentration = {};
  const zeroUse = {};
  for (const office of offices) {
    const rows = completed.filter((r) => r.office_key === office.key);
    const counts = new Map(office.services.map((s) => [s.service_id, 0]));
    for (const r of rows) counts.set(r.service_id, counts.get(r.service_id) + 1);
    const sorted = [...counts.values()].sort((a, b) => b - a);
    const topN = Math.max(1, Math.round(office.services.length / 5));
    concentration[office.key] = { services: office.services.length, top_fifth_services: topN, top_fifth_share_pct: pct(sorted.slice(0, topN).reduce((a, b) => a + b, 0), rows.length), excluded_without_standard: office.withoutStandard };
    zeroUse[office.key] = office.services.filter((s) => counts.get(s.service_id) === 0).map((s) => s.service_code);
  }
  const rateOf = (rows) => ({ rows: rows.length, late: rows.filter((r) => r.is_compliant === false).length, late_pct: pct(rows.filter((r) => r.is_compliant === false).length, rows.length) });
  const acad = completed.filter((r) => r.office_key === 'ACAD');
  const third = Math.floor(acad.length / 3);
  const perDayIn = (rows, filter) => rows.filter(filter).length;
  const assemblyRows = completed.filter((r) => r.service_id === patterns.assembly);
  const octDays = months.find(([m]) => m.endsWith('-10')) ? 1 : 0;
  const assemblyOct = perDayIn(assemblyRows, (r) => monthOf(dateOf(r.started_at)).endsWith('-10'));
  const assemblyOtherMonths = months.filter(([m]) => !m.endsWith('-10') && !m.endsWith('-11'));
  const assemblyOtherAvg = assemblyOtherMonths.length ? perDayIn(assemblyRows, (r) => !['-10', '-11'].some((s) => monthOf(dateOf(r.started_at)).endsWith(s))) / assemblyOtherMonths.length : null;
  const facilities = (suffix) => completed.filter((r) => patterns.facilities.includes(r.service_id) && monthOf(dateOf(r.started_at)).endsWith(suffix)).length;
  const lastFourWeeksFrom = toManilaDate(new Date(fromManila(options.to).getTime() - 27 * 86_400_000));
  const riskCoverage = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const row of open) riskCoverage[row.risk_level] += 1;
  return {
    period: { from: options.from, to: options.to, as_of: options.asOf, volume: options.volume },
    completed: completed.length,
    open: open.length,
    months: Object.fromEntries(Object.entries(byMonthOffice).map(([m, o]) => [m, Object.values(o).reduce((a, b) => a + b, 0)])),
    month_by_office: byMonthOffice,
    offices: Object.fromEntries(offices.map((o) => [o.key, completed.filter((r) => r.office_key === o.key).length])),
    client_mix: clientCounts,
    client_mix_pct: Object.fromEntries(Object.entries(clientCounts).map(([k, v]) => [k, pct(v, completed.length)])),
    registry: {
      matched: completed.filter((r) => r.registry_status === 'MATCHED').length,
      not_found: completed.filter((r) => r.registry_status === 'NOT_FOUND').length,
      expired: completed.filter((r) => r.registry_status === 'EXPIRED').length,
      misses_pct_of_lookups: pct(registryOutcome.misses, completed.filter((r) => ['STUDENT', 'ALUMNI'].includes(r.client_type)).length),
    },
    concentration,
    zero_use_services: zeroUse,
    late: { count: late.length, pct: pct(late.length, completed.length), bounds, clamped_to_as_of: completed.filter((r) => r.clamped).length, adjusted: completed.filter((r) => r.adjusted).length },
    patterns: {
      credential_rush_in_rush_weeks: rateOf(completed.filter((r) => r.group === 'rush')),
      assembly_october_vs_month_avg: { october: assemblyOct, other_month_avg: assemblyOtherAvg, has_october: Boolean(octDays) },
      facilities_sep_oct_nov: [facilities('-09'), facilities('-10'), facilities('-11')],
      generous_median_share_of_limit: median(completed.filter((r) => r.group === 'generous' && r.limit_minutes).map((r) => r.elapsed_working_minutes / r.limit_minutes)),
      chronic_delay: rateOf(completed.filter((r) => r.group === 'chronic')),
      acad_first_third: rateOf(acad.slice(0, third)),
      acad_last_third: rateOf(acad.slice(acad.length - third)),
      unusual_cases: completed.filter((r) => r.unusual).length,
      last_four_weeks: completed.filter((r) => dateOf(r.started_at) >= lastFourWeeksFrom && dateOf(r.started_at) <= options.to).length,
    },
    open_risk_coverage: riskCoverage,
    open_by_office: Object.fromEntries(offices.map((o) => [o.key, open.filter((r) => r.office_key === o.key).length])),
    started_outside_working_time: 0,
    contact_data_rows: 0,
  };
}

function checkTargets(d, bounds, problems) {
  if (d.late.count < bounds.min || d.late.count > bounds.max) problems.push(`late: ${d.late.count} computed late rows, outside ${bounds.min}-${bounds.max}`);
  if (d.late.pct < LATE_RATE.min * 100 || d.late.pct > LATE_RATE.max * 100) problems.push(`late: ${d.late.pct}% outside 15-18%`);
  for (const [type, share] of CLIENT_MIX) {
    if (Math.abs((d.client_mix_pct[type] ?? 0) - share) > CLIENT_MIX_TOLERANCE_POINTS) problems.push(`client mix: ${type} ${d.client_mix_pct[type]}% (plan ${share}%; service eligibility may not allow it)`);
  }
  if (d.open && (d.open < OPEN_MIN || d.open > OPEN_MAX)) problems.push(`open rows: ${d.open} outside ${OPEN_MIN}-${OPEN_MAX}`);
  const minPerLevel = Math.floor(d.open / 6);
  for (const level of ['LOW', 'MEDIUM', 'HIGH']) {
    if (d.open && d.open_risk_coverage[level] < Math.max(1, minPerLevel)) problems.push(`open rows: only ${d.open_risk_coverage[level]} at ${level} risk`);
  }
  if (d.patterns.unusual_cases < 3 || d.patterns.unusual_cases > 5) problems.push(`unusual cases: ${d.patterns.unusual_cases} (plan 3-5)`);
}
