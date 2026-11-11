import { Errors, assertOfficeAccess, isOfficeBound, isUuid, isValidManilaDate, officeFilter, toManilaDate } from 'ccms-shared';

const GROUP_FIELDS = Object.freeze({ office: 'office_id', service: 'service_id' });
const emptyCounts = () => ({ received: 0, backdated: 0, started_outside_hours: 0 });

function countStart(counts, row) {
  counts.received += 1;
  if (row.is_backdated === true) counts.backdated += 1;
  else if (row.started_outside_hours === true) counts.started_outside_hours += 1;
}

/** CC051 start figures for TT3. These figures use the Manila date of started_at. */
export function computeKpis(rows, { officeId, serviceId, from, to, groupBy = 'total' } = {}) {
  const totals = emptyCounts();
  const groups = new Map();
  const field = GROUP_FIELDS[groupBy];

  for (const row of rows) {
    if (officeId && row.office_id !== officeId) continue;
    if (serviceId && row.service_id !== serviceId) continue;
    const day = toManilaDate(row.started_at);
    if ((from && day < from) || (to && day > to)) continue;

    countStart(totals, row);
    if (field) {
      const id = row[field];
      if (!groups.has(id)) groups.set(id, { [field]: id, ...emptyCounts() });
      countStart(groups.get(id), row);
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
    `SELECT started_at, office_id, service_id, is_backdated, started_outside_hours
     FROM analytics_transactions
     WHERE started_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila')
       AND started_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')
       AND ($3::uuid IS NULL OR office_id = $3::uuid)
       AND ($4::uuid IS NULL OR service_id = $4::uuid)
     ORDER BY office_id, service_id`,
    [from, to, officeId, serviceId],
  );
  return { from, to, group_by: groupBy, ...computeKpis(rows, { officeId, serviceId, from, to, groupBy }) };
}
