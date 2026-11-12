import { randomUUID } from 'node:crypto';
import { ROLES, isUuid } from 'ccms-shared';
import { coreBaseUrl } from '../transaction/core-client.js';
import { identityBaseUrl } from '../transaction/identity-client.js';
import { mapLimit, sha256 } from './random.js';

// Sprint 6 TT1: everything the planner reads, gathered once, through the owning services' APIs (service key) and the
// Operations database (read only). Nothing here writes, sends mail or touches the calendar.

export class SeedInputError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'SeedInputError';
    this.details = details;
  }
}

async function getJson(baseUrl, path, { serviceKey, fetchImpl = fetch, timeoutMs = 15_000 }) {
  if (!baseUrl) throw new SeedInputError(`The service URL for ${path} is not configured`);
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { accept: 'application/json', 'x-service-key': serviceKey ?? '', 'x-correlation-id': randomUUID() },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new SeedInputError(`Could not reach ${new URL(baseUrl).host} for ${path}`);
  }
  if (!response.ok) throw new SeedInputError(`${new URL(baseUrl).host} answered ${response.status} for ${path.split('?')[0]}`);
  return response.json();
}

/** Core's catalogue as the planner needs it (offices, services with allowed client types, standards). */
export async function loadCatalogue({ serviceKey, fetchImpl, baseUrl = coreBaseUrl() }) {
  const data = await getJson(baseUrl, '/internal/seed-catalogue', { serviceKey, fetchImpl });
  if (!Array.isArray(data?.offices) || !Array.isArray(data?.services) || !Array.isArray(data?.standards)) {
    throw new SeedInputError('Core sent an unreadable seed catalogue (is the CC047 / TT1 Core release deployed?)');
  }
  return data;
}

/** Active Office Head / Office Staff accounts of each office, from Identity, in account_id order (K17). */
export async function loadAccounts(officeIds, { serviceKey, fetchImpl, baseUrl = identityBaseUrl() }) {
  const out = new Map();
  for (const officeId of officeIds) {
    const data = await getJson(baseUrl, `/internal/office-accounts?office_id=${encodeURIComponent(officeId)}`, { serviceKey, fetchImpl });
    const items = Array.isArray(data?.items) ? data.items : null;
    if (!items || !items.every((a) => isUuid(a.account_id) && [ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF].includes(a.role))) {
      throw new SeedInputError('Identity sent an unreadable account list');
    }
    out.set(officeId, [...items].sort((x, y) => x.account_id.localeCompare(y.account_id)).map((a) => ({
      id: a.account_id,
      role: a.role,
      name: typeof a.full_name === 'string' && a.full_name.trim() ? a.full_name.trim().slice(0, 200) : null,
      position: typeof a.position === 'string' && a.position.trim() ? a.position.trim().slice(0, 100) : null,
    })));
  }
  return out;
}

/** The operator recorded in the summary audit: verified independently against Identity (active Super Admin). */
export async function verifyOperator(operatorId, { serviceKey, fetchImpl, baseUrl = identityBaseUrl() }) {
  if (!isUuid(operatorId)) throw new SeedInputError('--operator must be the account id (UUID) of an active Super Admin');
  const data = await getJson(baseUrl, `/internal/operators/${encodeURIComponent(operatorId)}`, { serviceKey, fetchImpl });
  if (data?.account_id !== operatorId || data.role !== ROLES.SUPER_ADMIN || data.is_active !== true) {
    throw new SeedInputError('The operator is not an active Super Admin account');
  }
  return { id: operatorId, role: ROLES.SUPER_ADMIN };
}

/** CC043 registry, numbers/status/validity only (no names, no email). */
export async function loadRegistry(queryable) {
  return queryable.query('SELECT student_number, status, valid_until::text AS valid_until FROM registry_people ORDER BY student_number');
}

/** Staff accounts that already have a live open transaction (one open per staff: they cannot get a seeded open row). */
export async function loadBusyStaff(queryable) {
  const rows = await queryable.query(
    `SELECT DISTINCT t.started_by FROM transactions t
      WHERE t.status IN ('IN_PROGRESS', 'ON_HOLD')
        AND NOT EXISTS (SELECT 1 FROM seeded_transactions s WHERE s.transaction_id = t.transaction_id AND s.removed_at IS NULL)`,
  );
  return new Set(rows.map((r) => r.started_by));
}

const ONE_DAY = 86_400_000;
export function datesBetween(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += ONE_DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/**
 * The effective working intervals of each office on each date, from Core (CC048 office hours, campus fallback, breaks,
 * weekends, holidays and suspensions). Map officeId -> Map date -> [{ open, close }] in minutes from Manila midnight.
 */
export async function loadCalendar(core, officeIds, dates, { concurrency = 6 } = {}) {
  const jobs = officeIds.flatMap((officeId) => dates.map((date) => ({ officeId, date })));
  const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const answers = await mapLimit(jobs, concurrency, ({ officeId, date }) => core.isWorkingDay(date, officeId, { includeIntervals: true }));
  const out = new Map(officeIds.map((id) => [id, new Map()]));
  jobs.forEach(({ officeId, date }, index) => {
    const answer = answers[index];
    if (!answer.is_working_day) return;
    const windows = Array.isArray(answer.working_intervals) && answer.working_intervals.length ? answer.working_intervals : [answer.window];
    out.get(officeId).set(date, windows.map((w) => ({ open: toMinutes(w.opening_time), close: toMinutes(w.closing_time) })));
  });
  return out;
}

/** A digest of every input that shapes the plan (printed and stored; no personal data is printed). */
export function inputsDigest({ catalogue, accounts, registry, calendar, busyStaff }) {
  const canonical = JSON.stringify({
    offices: catalogue.offices.map((o) => [o.office_id, o.office_code, o.is_active]),
    services: catalogue.services.map((s) => [s.service_id, s.service_code, s.office_id, s.is_active, s.classification, s.allowed_client_types]),
    standards: catalogue.standards.map((s) => [s.standard_id, s.service_id, s.effective_from, s.effective_to, s.duration_days, s.duration_hours, s.duration_minutes]),
    accounts: [...accounts.entries()].sort().map(([office, list]) => [office, list.map((a) => [a.id, a.role, a.name, a.position])]),
    registry: registry.map((r) => [r.student_number, r.status, r.valid_until]),
    calendar: [...calendar.entries()].sort().map(([office, days]) => [office, [...days.entries()].sort()]),
    busy: [...busyStaff].sort(),
  });
  return sha256(canonical);
}
