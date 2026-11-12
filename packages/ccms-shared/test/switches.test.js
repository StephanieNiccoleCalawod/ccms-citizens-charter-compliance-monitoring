import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CAPABILITIES, ROLES, SWITCH_KEYS, capabilitiesFor, createSwitchGate, identityBaseUrl, requireSwitchForStaff } from '../src/index.js';

const env = { IDENTITY_URL: 'http://identity.test', SERVICE_KEY: 'k' };
const answer = (switches, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ switches }) });

describe('the switch gate (CC056)', () => {
  it('reads the switches from Identity with the service key; only a literal true is on', async () => {
    let seen;
    const gate = createSwitchGate({ env, fetchImpl: async (url, init) => { seen = { url, key: init.headers['x-service-key'] }; return { ok: true, json: async () => ({ switches: { STAFF_HOLD_RESUME: true, STAFF_BACKDATE: 'true', STAFF_VIEW_REPORTS: 1 } }) }; } });
    assert.equal(await gate.isEnabled('STAFF_HOLD_RESUME'), true);
    assert.equal(await gate.isEnabled('STAFF_BACKDATE'), false);
    assert.equal(await gate.isEnabled('STAFF_VIEW_REPORTS'), false);
    assert.equal(await gate.isEnabled('NOT_A_SWITCH'), false);
    assert.equal(seen.url, 'http://identity.test/api/internal/permission-switches');
    assert.equal(seen.key, 'k');
  });
  it('remembers the answer for at most 10 seconds, then asks again', async () => {
    let calls = 0;
    let t = 0;
    let on = false;
    const gate = createSwitchGate({ env, now: () => t, fetchImpl: async () => { calls += 1; return { ok: true, json: async () => ({ switches: { STAFF_HOLD_RESUME: on } }) }; } });
    assert.equal(await gate.isEnabled('STAFF_HOLD_RESUME'), false);
    on = true;
    t = 9_999;
    assert.equal(await gate.isEnabled('STAFF_HOLD_RESUME'), false); // still the remembered answer
    assert.equal(calls, 1);
    t = 10_000;
    assert.equal(await gate.isEnabled('STAFF_HOLD_RESUME'), true); // the Super Admin's change applies at the next request after 10 s
    assert.equal(calls, 2);
  });
  it('Identity down, slow, wrong or unconfigured = every switch off (AC3)', async () => {
    for (const [label, gate] of [
      ['throws', createSwitchGate({ env, fetchImpl: async () => { throw new Error('down'); } })],
      ['500', createSwitchGate({ env, fetchImpl: answer({}, false) })],
      ['unreadable', createSwitchGate({ env, fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('x'); } }) })],
      ['no url', createSwitchGate({ env: { SERVICE_KEY: 'k' }, fetchImpl: answer({ STAFF_HOLD_RESUME: true }) })],
      ['no key', createSwitchGate({ env: { IDENTITY_URL: 'http://i' }, fetchImpl: answer({ STAFF_HOLD_RESUME: true }) })],
    ]) {
      for (const key of SWITCH_KEYS) assert.equal(await gate.isEnabled(key), false, `${label} ${key}`);
    }
  });
  it('a failed answer is remembered only briefly so recovery is quick', async () => {
    let t = 0;
    let up = false;
    const gate = createSwitchGate({ env, now: () => t, fetchImpl: async () => (up ? { ok: true, json: async () => ({ switches: { STAFF_BACKDATE: true } }) } : { ok: false, status: 503 }) });
    assert.equal(await gate.isEnabled('STAFF_BACKDATE'), false);
    up = true;
    t = 2_001;
    assert.equal(await gate.isEnabled('STAFF_BACKDATE'), true);
  });
  it('accepts the Identity address with or without /api', () => {
    assert.equal(identityBaseUrl({ IDENTITY_URL: 'http://i/' }), 'http://i/api');
    assert.equal(identityBaseUrl({ IDENTITY_URL: 'http://i/api' }), 'http://i/api');
    assert.equal(identityBaseUrl({}), null);
  });
});

describe('requireSwitchForStaff', () => {
  const off = createSwitchGate({ env, fetchImpl: answer({}) });
  const on = createSwitchGate({ env, fetchImpl: answer({ STAFF_HOLD_RESUME: true }) });
  it('only Office Staff are decided by a switch', async () => {
    await assert.rejects(requireSwitchForStaff({ role: ROLES.OFFICE_STAFF }, 'STAFF_HOLD_RESUME', off), (e) => e.status === 403 && e.code === 'SWITCH_OFF');
    await requireSwitchForStaff({ role: ROLES.OFFICE_STAFF }, 'STAFF_HOLD_RESUME', on);
    for (const role of [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.EXECUTIVE]) await requireSwitchForStaff({ role }, 'STAFF_HOLD_RESUME', off);
  });
});

describe('the role rule table', () => {
  it('has exactly the four switches, and every switch cell is Office Staff only', () => {
    assert.deepEqual([...SWITCH_KEYS], ['STAFF_HOLD_RESUME', 'STAFF_BACKDATE', 'STAFF_VIEW_COMPLAINTS', 'STAFF_VIEW_REPORTS']);
    for (const row of CAPABILITIES) for (const [role, cell] of Object.entries(row.cells)) {
      if (typeof cell === 'object') { assert.equal(role, ROLES.OFFICE_STAFF); assert.ok(SWITCH_KEYS.includes(cell.switch)); }
      else assert.ok(['yes', 'no', 'own office', 'own records', 'read only'].includes(cell), `${row.key} ${role} ${cell}`);
    }
    for (const key of SWITCH_KEYS) assert.ok(CAPABILITIES.some((r) => r.cells[ROLES.OFFICE_STAFF]?.switch === key), key);
  });
  it('an Executive never writes and never changes permissions', () => {
    for (const row of CAPABILITIES) assert.ok(['no', 'read only', 'yes'].includes(row.cells[ROLES.EXECUTIVE]), row.key);
    assert.equal(CAPABILITIES.find((r) => r.key === 'permissions').cells[ROLES.EXECUTIVE], 'no');
    assert.equal(CAPABILITIES.find((r) => r.key === 'tx.start').cells[ROLES.EXECUTIVE], 'no');
  });
  it('a switch row follows the switch for Office Staff and nobody else', () => {
    const hold = (role, sw) => capabilitiesFor(role, sw).find((c) => c.key === 'tx.hold');
    assert.equal(hold(ROLES.OFFICE_STAFF, {}).access, 'no');
    assert.equal(hold(ROLES.OFFICE_STAFF, { STAFF_HOLD_RESUME: true }).access, 'yes');
    assert.equal(hold(ROLES.OFFICE_STAFF, { STAFF_HOLD_RESUME: true }).switchOn, true);
    assert.equal(hold(ROLES.OFFICE_HEAD, {}).access, 'own office');
    assert.equal(hold(ROLES.OFFICE_HEAD, {}).switchKey, null);
  });
});
