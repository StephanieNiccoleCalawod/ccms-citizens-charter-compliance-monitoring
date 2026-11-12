import { randomUUID } from 'node:crypto';
import { AppError, Errors, ROLES, assertOfficeAccess, isUuid } from 'ccms-shared';
import { loadKpis } from '../analytics/kpi.js';
import { resolvePeriod } from '../analytics/period.js';
import { loadNames } from './names.js';

// CC029 / CC030 / CC031: an office's accomplishment report for a period.
//   DRAFT       generated from the KPI module (the same figures as the dashboards); generating again refreshes it.
//   PUBLISHED   frozen. One per office and period. Later backdated, cancelled or auto-closed transactions do not change it.
//   SUPERSEDED  replaced by a newer version (published only with a reason); still readable.
// Who may do what (the server decides): Super Admin any office; Office Head their own office; Executive reads published and
// superseded reports of every office; Office Staff nothing until switch 4 exists (CC056). The Executive's view carries no names
// of staff and no staff ids; a report holds no per-staff figures at all.
export const PERIOD_TYPES = Object.freeze(['weekly', 'monthly', 'half_year', 'annual', 'custom']);
export const ACTION_PUBLISHED = 'REPORT_PUBLISHED';
const SELECT = `report_id, office_id, office_name, period_type, to_char(period_from, 'YYYY-MM-DD') AS period_from,
  to_char(period_to, 'YYYY-MM-DD') AS period_to, version, status, figures, generated_by, generated_at, published_by,
  published_by_name, published_at, supersede_reason, supersedes_report_id,
  (SELECT n.report_id FROM reports n WHERE n.supersedes_report_id = r.report_id ORDER BY n.version DESC LIMIT 1) AS replaced_by_report_id,
  (SELECT n.version FROM reports n WHERE n.supersedes_report_id = r.report_id ORDER BY n.version DESC LIMIT 1) AS replaced_by_version`;

const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);
const iso = (value) => (value ? new Date(value).toISOString() : null);
const lower = (value) => (value ? String(value).toLowerCase() : value);

/** The report as the browser gets it. The Executive does not get who generated or published it. */
export function reportDto(row, viewer, { withFigures = true } = {}) {
  const executive = viewer.role === ROLES.EXECUTIVE;
  const dto = {
    report_id: row.report_id, office_id: row.office_id, office_name: row.office_name, period_type: row.period_type,
    from: row.period_from, to: row.period_to, version: row.version, status: row.status,
    generated_at: iso(row.generated_at), published_at: iso(row.published_at),
    supersede_reason: row.supersede_reason, supersedes_report_id: row.supersedes_report_id,
    replaced_by_report_id: row.replaced_by_report_id ?? null, replaced_by_version: row.replaced_by_version ?? null,
  };
  if (!executive) {
    dto.published_by = row.published_by;
    dto.published_by_name = row.published_by_name;
  }
  if (withFigures) dto.figures = row.figures;
  return dto;
}

function assertMayManage(actor, officeId) {
  if (actor.role !== ROLES.SUPER_ADMIN && actor.role !== ROLES.OFFICE_HEAD) throw Errors.forbidden();
  if (actor.role === ROLES.OFFICE_HEAD) assertOfficeAccess(actor, lower(officeId));
}

async function buildFigures(db, { officeId, period, now, authorization }) {
  const [total, byService, names] = await Promise.all([
    loadKpis(db, { officeId, groupBy: 'total', period, now }),
    loadKpis(db, { officeId, groupBy: 'service', period, now }),
    loadNames({ officeId, authorization }),
  ]);
  return {
    office_name: names.officeName,
    figures: {
      basis: 'Received counts by start date; results by end date. Auto-closed transactions count as late.',
      generated_for: { from: period.from, to: period.to },
      total: total.totals,
      services: byService.groups
        .map(({ service_id: serviceId, ...rest }) => ({ service_id: serviceId, service_name: names.services.get(serviceId) ?? null, ...rest }))
        .sort((a, b) => String(a.service_name ?? '~').localeCompare(String(b.service_name ?? '~')) || a.service_id.localeCompare(b.service_id)),
    },
  };
}

function parseGenerate(body) {
  const officeId = body?.officeId ?? body?.office_id;
  if (!isUuid(officeId)) throw Errors.validation('Choose an office.', { officeId: 'Choose an office.' });
  const requested = body?.periodType ?? body?.period_type ?? 'half_year';
  if (!PERIOD_TYPES.includes(requested)) throw Errors.validation('Choose weekly, monthly, half-year, annual or custom.', { periodType: 'Choose weekly, monthly, half-year, annual or custom.' });
  return { officeId: officeId.toLowerCase(), query: { period: requested, from: body?.from, to: body?.to, date: body?.date } };
}

/** POST /reports: creates the draft for the office and period, or refreshes the one that exists. */
export async function generateReport(db, actor, body, { authorization, now = new Date() } = {}) {
  const { officeId, query } = parseGenerate(body);
  assertMayManage(actor, officeId);
  const period = resolvePeriod(query, now);
  const generated = await buildFigures(db, { officeId, period, now, authorization });
  return db.transaction(async (manager) => {
    const key = [officeId, period.type, period.from, period.to];
    const [draft] = rowsOf(await manager.query(`SELECT report_id FROM reports WHERE office_id = $1 AND period_type = $2 AND period_from = $3 AND period_to = $4 AND status = 'DRAFT' FOR UPDATE`, key));
    let id;
    if (draft) {
      id = draft.report_id;
      await manager.query(
        `UPDATE reports SET figures = $2::jsonb, office_name = $3, generated_by = $4, generated_at = $5 WHERE report_id = $1 AND status = 'DRAFT'`,
        [id, JSON.stringify(generated.figures), generated.office_name, actor.id, now],
      );
    } else {
      const [published] = rowsOf(await manager.query(`SELECT report_id, version FROM reports WHERE office_id = $1 AND period_type = $2 AND period_from = $3 AND period_to = $4 AND status = 'PUBLISHED'`, key));
      if (published) {
        throw Errors.conflict('This office and period already has a published report. Use "Correct with a new version" to change it.', 'REPORT_ALREADY_PUBLISHED', { report_id: published.report_id, version: published.version });
      }
      const [{ next }] = rowsOf(await manager.query(`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM reports WHERE office_id = $1 AND period_type = $2 AND period_from = $3 AND period_to = $4`, key));
      id = randomUUID();
      await manager.query(
        `INSERT INTO reports (report_id, office_id, office_name, period_type, period_from, period_to, version, status, figures, generated_by, generated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8::jsonb, $9, $10)`,
        [id, officeId, generated.office_name, period.type, period.from, period.to, next, JSON.stringify(generated.figures), actor.id, now],
      );
    }
    return fetchReport(manager, actor, id);
  });
}

async function loadRow(db, id, { forUpdate = false } = {}) {
  if (!isUuid(id)) throw Errors.notFound('Report not found', 'REPORT_NOT_FOUND');
  const [row] = rowsOf(await db.query(`SELECT ${SELECT} FROM reports r WHERE report_id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id]));
  if (!row) throw Errors.notFound('Report not found', 'REPORT_NOT_FOUND');
  return row;
}

/** Who may read this row. A report the person may not read is a 404, never a hint that it exists. */
export function canRead(actor, row) {
  if (actor.role === ROLES.SUPER_ADMIN) return true;
  if (actor.role === ROLES.EXECUTIVE) return row.status !== 'DRAFT';
  if (actor.role === ROLES.OFFICE_HEAD) return lower(row.office_id) === lower(actor.officeId);
  return false; // Office Staff: switch 4 (CC056) is not built; the route refuses them with 403 first
}

export async function fetchReport(db, actor, id) {
  const row = await loadRow(db, id);
  if (!canRead(actor, row)) throw Errors.notFound('Report not found', 'REPORT_NOT_FOUND');
  return reportDto(row, actor);
}

/** GET /reports?office_id=&period_type=&status=&page=&page_size= : newest period first, without the figures. */
export async function listReports(db, actor, params) {
  const where = [];
  const values = [];
  const add = (sql, value) => { values.push(value); where.push(sql.replaceAll('?', `$${values.length}`)); };
  if (actor.role === ROLES.EXECUTIVE) where.push(`status <> 'DRAFT'`);
  else if (actor.role === ROLES.OFFICE_HEAD) add('office_id = ?::uuid', actor.officeId);
  else if (actor.role !== ROLES.SUPER_ADMIN) throw Errors.forbidden();
  const officeId = params.get('office_id');
  const periodType = params.get('period_type');
  const status = params.get('status');
  const details = {};
  if (officeId && !isUuid(officeId)) details.office_id = 'Choose a valid office.';
  if (periodType && !PERIOD_TYPES.includes(periodType)) details.period_type = 'Choose a valid period.';
  if (status && !['DRAFT', 'PUBLISHED', 'SUPERSEDED'].includes(status)) details.status = 'Choose a valid status.';
  const num = (name, fallback, max) => {
    const raw = params.get(name);
    if (raw === null || raw === '') return fallback;
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > max) { details[name] = `${name} must be a whole number from 1 to ${max}`; return fallback; }
    return n;
  };
  const page = num('page', 1, 1_000_000);
  const pageSize = num('page_size', 20, 100);
  if (Object.keys(details).length) throw Errors.validation('Please correct the highlighted fields', details);
  if (officeId) {
    if (actor.role === ROLES.OFFICE_HEAD && lower(officeId) !== lower(actor.officeId)) throw Errors.forbidden();
    add('office_id = ?::uuid', officeId);
  }
  if (periodType) add('period_type = ?', periodType);
  if (status) add('status = ?', status);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = rowsOf(await db.query(`SELECT count(*)::int AS total FROM reports ${clause}`, values));
  const rows = rowsOf(await db.query(
    `SELECT ${SELECT} FROM reports r ${clause} ORDER BY period_from DESC, period_to DESC, office_name NULLS LAST, version DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    values,
  ));
  return { items: rows.map((row) => reportDto(row, actor, { withFigures: false })), total, page, page_size: pageSize };
}

async function writeAudit(manager, actor, row, extra = {}) {
  await manager.query(
    `INSERT INTO audit_log (audit_id, actor_user_id, actor_role, action, entity_type, entity_id, entity_name, office_id, before_value, after_value, occurred_at)
     VALUES ($1, $2, $3, $4, 'report', $5, NULL, $6, $7::jsonb, $8::jsonb, now())`,
    [randomUUID(), actor.id, actor.role, ACTION_PUBLISHED, row.report_id, row.office_id,
      JSON.stringify({ status: 'DRAFT' }),
      JSON.stringify({ status: 'PUBLISHED', version: row.version, period_type: row.period_type, from: row.period_from, to: row.period_to, ...extra })],
  );
}

/** POST /reports/:id/publish {confirm: true}: freezes the draft. A second publish for the same office and period is refused. */
export async function publishReport(db, actor, id, body, { now = new Date() } = {}) {
  if (body?.confirm !== true) throw Errors.validation('Confirm that you want to publish this report.', { confirm: 'Confirm that you want to publish this report.' });
  return db.transaction(async (manager) => {
    const row = await loadRow(manager, id, { forUpdate: true });
    assertMayManage(actor, row.office_id);
    if (row.status !== 'DRAFT') {
      throw Errors.conflict('This report is already published. Use "Correct with a new version" to change it.', 'REPORT_NOT_A_DRAFT', { status: row.status });
    }
    const key = [row.office_id, row.period_type, row.period_from, row.period_to];
    if (row.supersedes_report_id) {
      // Version n+1: the version it replaces becomes SUPERSEDED first (only one report per period may be PUBLISHED).
      const [old] = rowsOf(await manager.query(`SELECT report_id, status FROM reports WHERE report_id = $1 FOR UPDATE`, [row.supersedes_report_id]));
      if (!old || old.status !== 'PUBLISHED') throw Errors.conflict('The report this version replaces is no longer published.', 'REPORT_BASE_CHANGED');
      await manager.query(`UPDATE reports SET status = 'SUPERSEDED' WHERE report_id = $1 AND status = 'PUBLISHED'`, [old.report_id]);
    } else {
      const [published] = rowsOf(await manager.query(`SELECT report_id FROM reports WHERE office_id = $1 AND period_type = $2 AND period_from = $3 AND period_to = $4 AND status = 'PUBLISHED'`, key));
      if (published) throw Errors.conflict('This office and period already has a published report.', 'REPORT_ALREADY_PUBLISHED', { report_id: published.report_id });
    }
    await manager.query(
      `UPDATE reports SET status = 'PUBLISHED', published_by = $2, published_by_name = $3, published_at = $4 WHERE report_id = $1 AND status = 'DRAFT'`,
      [row.report_id, actor.id, actor.fullName ? String(actor.fullName).slice(0, 200) : null, now],
    );
    await writeAudit(manager, actor, row, row.supersedes_report_id ? { replaces_report_id: row.supersedes_report_id, reason: row.supersede_reason } : {});
    return reportDto(await loadRow(manager, id), actor);
  });
}

/** POST /reports/:id/new-version {reason}: a draft n+1 of a published report, with fresh figures. Publishing it supersedes n. */
export async function startNewVersion(db, actor, id, body, { authorization, now = new Date() } = {}) {
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 500) {
    throw Errors.validation('Give the reason for the correction (1 to 500 characters).', { reason: 'Give the reason for the correction (1 to 500 characters).' });
  }
  const base = await loadRow(db, id);
  assertMayManage(actor, base.office_id);
  if (base.status !== 'PUBLISHED') throw Errors.conflict('Only the current published report can be corrected.', 'REPORT_NOT_PUBLISHED', { status: base.status });
  const period = { type: base.period_type, from: base.period_from, to: base.period_to };
  const generated = await buildFigures(db, { officeId: lower(base.office_id), period, now, authorization });
  return db.transaction(async (manager) => {
    const current = await loadRow(manager, id, { forUpdate: true });
    if (current.status !== 'PUBLISHED') throw Errors.conflict('Only the current published report can be corrected.', 'REPORT_NOT_PUBLISHED', { status: current.status });
    const key = [current.office_id, current.period_type, current.period_from, current.period_to];
    const [draft] = rowsOf(await manager.query(`SELECT report_id FROM reports WHERE office_id = $1 AND period_type = $2 AND period_from = $3 AND period_to = $4 AND status = 'DRAFT'`, key));
    if (draft) throw new AppError(409, 'REPORT_DRAFT_EXISTS', 'A new version is already being prepared for this period.', { report_id: draft.report_id });
    const [{ next }] = rowsOf(await manager.query(`SELECT MAX(version) + 1 AS next FROM reports WHERE office_id = $1 AND period_type = $2 AND period_from = $3 AND period_to = $4`, key));
    const newId = randomUUID();
    await manager.query(
      `INSERT INTO reports (report_id, office_id, office_name, period_type, period_from, period_to, version, status, figures, generated_by, generated_at, supersede_reason, supersedes_report_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8::jsonb, $9, $10, $11, $12)`,
      [newId, current.office_id, generated.office_name ?? current.office_name, current.period_type, current.period_from, current.period_to, next,
        JSON.stringify(generated.figures), actor.id, now, reason, current.report_id],
    );
    return fetchReport(manager, actor, newId);
  });
}
