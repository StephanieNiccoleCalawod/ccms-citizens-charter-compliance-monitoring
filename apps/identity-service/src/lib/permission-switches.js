import { CAPABILITIES, Errors, ROLES, ROLE_LIST, ROLE_LABELS, SWITCH_INFO, SWITCH_KEYS, recordAudit } from 'ccms-shared';
import { kickOutbox } from './outbox.js';

// CC056: the four staff permission switches. Default off, scope 'ALL'. Only the Super Admin changes them; every change is
// audited with the value before and after. Nothing outside these four can be changed here (AC5).
const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES = ['ALL', 'SPECIFIC'];
const ALLOWED_OBJECT_KEYS = new Set(['enabled', 'scope', 'office_ids', 'officeIds']);

function normalizeOfficeIds(rawIds) {
  return [...new Set(rawIds.map((id) => String(id).trim().toLowerCase()))].sort();
}

function sameList(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function parseSwitchEntry(value) {
  if (typeof value === 'boolean') return { mode: 'boolean', enabled: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Use true, false, or { enabled, scope, office_ids }.' };
  }
  const unknown = Object.keys(value).filter((k) => !ALLOWED_OBJECT_KEYS.has(k));
  if (unknown.length) return { error: `Unknown field(s): ${unknown.join(', ')}.` };
  if (typeof value.enabled !== 'boolean') return { error: 'enabled must be true or false.' };
  const scope = value.scope === undefined ? 'ALL' : value.scope;
  if (!SCOPES.includes(scope)) return { error: 'scope must be ALL or SPECIFIC.' };
  const rawIds = value.office_ids !== undefined ? value.office_ids : value.officeIds;
  if (scope === 'ALL') {
    if (rawIds !== undefined && (!Array.isArray(rawIds) || rawIds.length > 0)) {
      return { error: 'Leave office_ids empty when scope is ALL.' };
    }
    return { mode: 'object', enabled: value.enabled, scope: 'ALL', officeIds: [] };
  }
  if (!Array.isArray(rawIds)) return { error: 'office_ids must be an array of office IDs when scope is SPECIFIC.' };
  if (rawIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id.trim()))) {
    return { error: 'Every office_id must be a valid UUID.' };
  }
  const officeIds = normalizeOfficeIds(rawIds);
  if (value.enabled && officeIds.length === 0) {
    return { error: 'Select at least one office when scope is SPECIFIC.' };
  }
  return { mode: 'object', enabled: value.enabled, scope: 'SPECIFIC', officeIds };
}

/**
 * Effective { KEY: boolean } for a given office (null = global ALL-only switches; SPECIFIC switches are off when no
 * matching officeId is provided).
 */
export async function readSwitchValuesForOffice(db, officeId = null) {
  const rows = rowsOf(await db.query('SELECT switch_key, enabled, scope FROM permission_switches'));
  const normalizedOffice = typeof officeId === 'string' && UUID_RE.test(officeId.trim()) ? officeId.trim().toLowerCase() : null;
  const officeRows = normalizedOffice
    ? rowsOf(await db.query('SELECT switch_key FROM permission_switch_offices WHERE office_id = $1', [normalizedOffice]))
    : [];
  const allowed = new Set(officeRows.map((r) => r.switch_key));
  const values = Object.fromEntries(SWITCH_KEYS.map((key) => [key, false]));
  for (const row of rows) {
    if (!SWITCH_KEYS.includes(row.switch_key) || row.enabled !== true) continue;
    values[row.switch_key] = row.scope === 'SPECIFIC' ? allowed.has(row.switch_key) : true;
  }
  return values;
}

/** { KEY: boolean } for global (ALL-scoped) switches; SPECIFIC switches stay off without an office_id. */
export const readSwitchValues = (db) => readSwitchValuesForOffice(db, null);

/** The Super Admin's view: each switch with its label, scope, office_ids, and who/when last changed it, plus the matrix. */
export async function getSwitchesView(db) {
  const rows = rowsOf(await db.query('SELECT switch_key, enabled, scope, updated_by, updated_at FROM permission_switches'));
  const officeRows = rowsOf(await db.query('SELECT switch_key, office_id FROM permission_switch_offices ORDER BY office_id'));
  const officesByKey = new Map();
  for (const r of officeRows) {
    const id = String(r.office_id).toLowerCase();
    const list = officesByKey.get(r.switch_key);
    if (list) list.push(id);
    else officesByKey.set(r.switch_key, [id]);
  }
  const byKey = new Map(rows.map((r) => [r.switch_key, r]));
  return {
    switches: SWITCH_KEYS.map((key) => {
      const row = byKey.get(key);
      const scope = row?.scope === 'SPECIFIC' ? 'SPECIFIC' : 'ALL';
      return {
        key,
        label: SWITCH_INFO[key].label,
        description: SWITCH_INFO[key].description,
        enabled: row?.enabled === true,
        scope,
        office_ids: scope === 'SPECIFIC' ? (officesByKey.get(key) ?? []) : [],
        updated_by: row?.updated_by ?? null,
        updated_at: row?.updated_at ?? null,
      };
    }),
    matrix: {
      roles: ROLE_LIST.map((role) => ({ role, label: ROLE_LABELS[role] })),
      rows: CAPABILITIES.map((c) => ({
        key: c.key, group: c.group, label: c.label,
        cells: Object.fromEntries(ROLE_LIST.map((role) => [role, typeof c.cells[role] === 'object' ? { switch: c.cells[role].switch } : c.cells[role]])),
      })),
    },
  };
}

/**
 * PUT body: { switches: { KEY: true|false | { enabled, scope: 'ALL'|'SPECIFIC', office_ids: [...] } } }.
 * A plain boolean updates `enabled` only (preserving scope and offices). Returns the updated view.
 */
export async function updateSwitches(db, actor, body, { ipAddress } = {}) {
  const incoming = body?.switches;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || Object.keys(incoming).length === 0) {
    throw Errors.validation('Send { "switches": { "STAFF_HOLD_RESUME": true } } with at least one switch.', { switches: 'At least one switch is required.' });
  }
  const details = {};
  const parsed = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (!SWITCH_KEYS.includes(key)) {
      details[key] = 'This is not one of the four staff permission switches.';
      continue;
    }
    const entry = parseSwitchEntry(value);
    if (entry.error) details[key] = entry.error;
    else parsed[key] = entry;
  }
  if (Object.keys(details).length) throw Errors.validation('Only the four staff permission switches can be changed.', details);

  await db.transaction(async (manager) => {
    const rows = rowsOf(await manager.query('SELECT switch_key, enabled, scope FROM permission_switches FOR UPDATE'));
    const officeRows = rowsOf(await manager.query('SELECT switch_key, office_id FROM permission_switch_offices ORDER BY office_id'));
    const currentOffices = new Map();
    for (const r of officeRows) {
      const id = String(r.office_id).toLowerCase();
      const list = currentOffices.get(r.switch_key);
      if (list) list.push(id);
      else currentOffices.set(r.switch_key, [id]);
    }
    const current = new Map(rows.map((r) => [r.switch_key, { enabled: r.enabled === true, scope: r.scope === 'SPECIFIC' ? 'SPECIFIC' : 'ALL' }]));

    for (const [key, entry] of Object.entries(parsed)) {
      const prev = current.get(key) ?? { enabled: false, scope: 'ALL' };
      const beforeEnabled = prev.enabled;
      const beforeScope = prev.scope;
      const beforeOfficeIds = beforeScope === 'SPECIFIC' ? (currentOffices.get(key) ?? []) : [];

      const nextEnabled = entry.enabled;
      const nextScope = entry.mode === 'boolean' ? beforeScope : entry.scope;
      const nextOfficeIds = entry.mode === 'boolean' ? beforeOfficeIds : entry.officeIds;

      if (beforeEnabled === nextEnabled && beforeScope === nextScope && sameList(beforeOfficeIds, nextOfficeIds)) {
        continue; // nothing changed, nothing to audit
      }

      await manager.query(
        `INSERT INTO permission_switches (switch_key, enabled, scope, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (switch_key) DO UPDATE SET enabled = EXCLUDED.enabled, scope = EXCLUDED.scope, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, nextEnabled, nextScope, actor.id],
      );

      if (entry.mode === 'object') {
        await manager.query('DELETE FROM permission_switch_offices WHERE switch_key = $1', [key]);
        if (nextScope === 'SPECIFIC' && nextOfficeIds.length > 0) {
          await manager.query(
            'INSERT INTO permission_switch_offices (switch_key, office_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING',
            [key, nextOfficeIds],
          );
        }
      }

      const includeScope = beforeScope !== 'ALL' || nextScope !== 'ALL' || beforeOfficeIds.length > 0 || nextOfficeIds.length > 0;
      await recordAudit(manager, {
        actor,
        action: 'PERMISSION_SWITCH_CHANGED',
        entityType: 'permission_switch',
        entityId: key,
        before: { switch: key, enabled: beforeEnabled, ...(includeScope ? { scope: beforeScope, office_ids: beforeOfficeIds } : {}) },
        after: { switch: key, enabled: nextEnabled, ...(includeScope ? { scope: nextScope, office_ids: nextOfficeIds } : {}) },
        ipAddress,
      });
    }
  });
  kickOutbox();
  return getSwitchesView(db);
}

export { ROLES };
