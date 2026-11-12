import { CAPABILITIES, Errors, ROLES, ROLE_LIST, ROLE_LABELS, SWITCH_INFO, SWITCH_KEYS, recordAudit } from 'ccms-shared';
import { kickOutbox } from './outbox.js';

// CC056: the four staff permission switches. Default off. Only the Super Admin changes them; every change is audited with the
// value before and after. Nothing outside these four can be changed here (AC5).
const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);

/** { KEY: boolean } for all four (a missing row counts as off). */
export async function readSwitchValues(db) {
  const rows = rowsOf(await db.query('SELECT switch_key, enabled FROM permission_switches'));
  const values = Object.fromEntries(SWITCH_KEYS.map((key) => [key, false]));
  for (const row of rows) if (SWITCH_KEYS.includes(row.switch_key)) values[row.switch_key] = row.enabled === true;
  return values;
}

/** The Super Admin's view: each switch with its label and who/when last changed it, plus the full read-only matrix. */
export async function getSwitchesView(db) {
  const rows = rowsOf(await db.query('SELECT switch_key, enabled, updated_by, updated_at FROM permission_switches'));
  const byKey = new Map(rows.map((r) => [r.switch_key, r]));
  return {
    switches: SWITCH_KEYS.map((key) => ({
      key, label: SWITCH_INFO[key].label, description: SWITCH_INFO[key].description,
      enabled: byKey.get(key)?.enabled === true, updated_by: byKey.get(key)?.updated_by ?? null, updated_at: byKey.get(key)?.updated_at ?? null,
    })),
    matrix: {
      roles: ROLE_LIST.map((role) => ({ role, label: ROLE_LABELS[role] })),
      rows: CAPABILITIES.map((c) => ({
        key: c.key, group: c.group, label: c.label,
        cells: Object.fromEntries(ROLE_LIST.map((role) => [role, typeof c.cells[role] === 'object' ? { switch: c.cells[role].switch } : c.cells[role]])),
      })),
    },
  };
}

/** PUT body: { switches: { STAFF_HOLD_RESUME: true, ... } } with real booleans and only the four keys. Returns the new view. */
export async function updateSwitches(db, actor, body, { ipAddress } = {}) {
  const incoming = body?.switches;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || Object.keys(incoming).length === 0) {
    throw Errors.validation('Send { "switches": { "STAFF_HOLD_RESUME": true } } with at least one switch.', { switches: 'At least one switch is required.' });
  }
  const details = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (!SWITCH_KEYS.includes(key)) details[key] = 'This is not one of the four staff permission switches.';
    else if (typeof value !== 'boolean') details[key] = 'Use true or false.';
  }
  if (Object.keys(details).length) throw Errors.validation('Only the four staff permission switches can be changed.', details);

  await db.transaction(async (manager) => {
    const rows = rowsOf(await manager.query('SELECT switch_key, enabled FROM permission_switches FOR UPDATE'));
    const current = new Map(rows.map((r) => [r.switch_key, r.enabled === true]));
    for (const [key, enabled] of Object.entries(incoming)) {
      const before = current.get(key) ?? false;
      if (before === enabled) continue; // nothing changed, nothing to audit
      await manager.query(
        `INSERT INTO permission_switches (switch_key, enabled, updated_by, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (switch_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, enabled, actor.id],
      );
      await recordAudit(manager, {
        actor, action: 'PERMISSION_SWITCH_CHANGED', entityType: 'permission_switch', entityId: key,
        before: { switch: key, enabled: before }, after: { switch: key, enabled }, ipAddress,
      });
    }
  });
  kickOutbox();
  return getSwitchesView(db);
}

export { ROLES };
