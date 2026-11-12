import { Errors, assertOfficeAccess, isOfficeBound, isUuid, isValidManilaDate, officeFilter, toManilaDate } from 'ccms-shared';

const GROUP_FIELDS = Object.freeze({ office: 'office_id', service: 'service_id' });
const NOT_IN_REGISTRY = new Set(['NOT_FOUND', 'EXPIRED']);
const MISS_REASONS = ['OLDER_ALUMNI', 'NEW_ENROLLEE', 'RETURNING_STUDENT', 'NAME_DIFFERS', 'OTHER'];
// CC050: completed transactions by recorded outcome. Only COMPLETED rows count (never in-progress, held, cancelled or
// auto-closed ones); null is a completion recorded before outcomes existed ("Not recorded"). Matched against these exact
// values, so an unexpected value is never counted as either decision. The disapproval reason is not in the analytics store.
const OUTCOME_BUCKETS = Object.freeze({ GRANTED: 'granted', DISAPPROVED: 'disapproved' });
const emptyOutcomes = () => ({ completed: 0, granted: 0, disapproved: 0, not_recorded: 0 });
const emptyCounts = () => ({
  received: 0, backdated: 0, started_outside_hours: 0,
  // CC044 (K5): "Not in registry" = NOT_FOUND or EXPIRED, per office and per reason code.
  not_in_registry: 0,
  not_in_registry_by_reason: Object.fromEntries(MISS_REASONS.map((reason) => [reason, 0])),
  outcomes: emptyOutcomes(),
});

function countStart(counts, row) {
  counts.received += 1;
  if (row.is_backdated === true) counts.backdated += 1;
  else if (row.started_outside_hours === true) counts.started_outside_hours += 1;
  if (NOT_IN_REGISTRY.has(row.registry_status)) {
    counts.not_in_registry += 1;
    if (Object.hasOwn(counts.not_in_registry_by_reason, row.registry_miss_reason)) counts.not_in_registry_by_reason[row.registry_miss_reason] += 1;
  }
}

/** The outcome bucket of a completed row, or null when the row is not a completion this report counts. */
function outcomeBucket(row) {
  if (row.status !== 'COMPLETED' || !row.ended_at) return null;
  if (row.outcome == null) return 'not_recorded';
  return OUTCOME_BUCKETS[row.outcome] ?? null;
}

function countOutcome(counts, bucket) {
  counts.outcomes[bucket] += 1;
  counts.outcomes.completed += 1;
}

const inRange = (day, from, to) => !((from && day < from) || (to && day > to));

/**
 * CC051 start figures for TT3, plus the CC050 outcome totals.
 *   received, backdated, outside hours, not in registry   the Manila date of started_at is in the period (CC051)
 *   outcomes                                              status COMPLETED and the Manila date of ended_at is in the period
 *                                                          (Sprint 5-8 spec 2.3: "Completed: status COMPLETED, ended in the period")
 * The office and service filters apply to both. A row can count as received in one period and completed in another.
 */
export function computeKpis(rows, { officeId, serviceId, from, to, groupBy = 'total' } = {}) {
  const totals = emptyCounts();
  const groups = new Map();
  const field = GROUP_FIELDS[groupBy];
  const groupOf = (row) => {
    const id = row[field];
    if (!groups.has(id)) groups.set(id, { [field]: id, ...emptyCounts() });
    return groups.get(id);
  };

  for (const row of rows) {
    if (officeId && row.office_id !== officeId) continue;
    if (serviceId && row.service_id !== serviceId) continue;

    if (inRange(toManilaDate(row.started_at), from, to)) {
      countStart(totals, row);
      if (field) countStart(groupOf(row), row);
    }
    const bucket = outcomeBucket(row);
    if (bucket && inRange(toManilaDate(row.ended_at), from, to)) {
      countOutcome(totals, bucket);
      if (field) countOutcome(groupOf(row), bucket);
    }
  }
  return { totals, groups: [...groups.values()] };
}

function currentHalfYear(now) {
  const today = toManilaDate(now);
  const year = today.slice(0, 4);
  return today.slice(5, 7) <= '06'
    ? { from: `${year}-01-01`, to: `${year}-06-30` }
    : { from: `${year}-07-01`, to: `${year}-12-31` };
}

export async function getStartKpis(dataSource, actor, query, now = new Date()) {
  const officeId = query.get('office_id') || officeFilter(actor);
  const serviceId = query.get('service_id') || null;
  if (officeId && !isUuid(officeId)) throw Errors.validation('Choose a valid office.');
  if (serviceId && !isUuid(serviceId)) throw Errors.validation('Choose a valid service.');
  if (isOfficeBound(actor.role)) assertOfficeAccess(actor, officeId);

  const defaults = currentHalfYear(now);
  const from = query.get('from') ?? defaults.from;
  const to = query.get('to') ?? defaults.to;
  const groupBy = query.get('group_by') ?? 'total';
  if (!isValidManilaDate(from) || !isValidManilaDate(to) || from > to) throw Errors.validation('Choose a valid date range.');
  if (!['total', 'office', 'service'].includes(groupBy)) throw Errors.validation('Group the figures by total, office, or service.');

  const rows = await dataSource.query(
    // Started in the period (the CC051 figures) or completed in it (the CC050 outcome totals); computeKpis sorts them out.
    `SELECT started_at, ended_at, office_id, service_id, is_backdated, started_outside_hours, registry_status, registry_miss_reason, status, outcome
     FROM analytics_transactions
     WHERE ((started_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila')
             AND started_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'))
         OR (status = 'COMPLETED'
             AND ended_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila')
             AND ended_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')))
       AND ($3::uuid IS NULL OR office_id = $3::uuid)
       AND ($4::uuid IS NULL OR service_id = $4::uuid)
     ORDER BY office_id, service_id`,
    [from, to, officeId, serviceId],
  );
  return { from, to, group_by: groupBy, ...computeKpis(rows, { officeId, serviceId, from, to, groupBy }) };
}
