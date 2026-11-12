// CC056 x CC031: Office Staff read their own office's PUBLISHED reports only while STAFF_VIEW_REPORTS is on.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { GET as listRoute, POST as generateRoute } from '../src/app/api/reports/route.js';
import { GET as oneRoute } from '../src/app/api/reports/[id]/route.js';
import { GET as csvRoute } from '../src/app/api/reports/[id]/export.csv/route.js';
import { POST as publishRoute } from '../src/app/api/reports/[id]/publish/route.js';
import { OFFICE_A, OFFICE_B, USERS, call, req, setupTestEnv, switchState, tokens } from './helpers.js';

let env;
before(async () => { env = await setupTestEnv(); });
after(async () => env?.teardown());
beforeEach(async () => {
  await env.ds.query('DELETE FROM reports');
  switchState.STAFF_VIEW_REPORTS = false;
});

async function insert(officeId, status, day) {
  const id = randomUUID();
  await env.ds.query(
    `INSERT INTO reports (report_id, office_id, office_name, period_type, period_from, period_to, version, status, figures, generated_by, published_by, published_by_name, published_at)
     VALUES ($1,$2,'Office',$3,$4,$5,1,$6,'{"services":[],"total":{}}'::jsonb,$7,$8,$9,$10)`,
    [id, officeId, 'custom', day, day, status, USERS.headA, status === 'DRAFT' ? null : USERS.headA, status === 'DRAFT' ? null : 'Head Person', status === 'DRAFT' ? null : new Date().toISOString()],
  );
  return id;
}
const list = (token, q = '') => call(listRoute, req('GET', `/reports${q}`, { token }));
const one = (token, id) => call(oneRoute, req('GET', `/reports/${id}`, { token }), { params: { id } });
const csv = async (token, id) => (await csvRoute(req('GET', `/reports/${id}/export.csv`, { token }), { params: { id } })).status;

describe('CC056 Office Staff and reports', () => {
  it('switch off: 403 on list, detail and CSV', async () => {
    const id = await insert(OFFICE_A, 'PUBLISHED', '2026-10-01');
    assert.equal((await list(tokens.officeStaffA)).status, 403);
    assert.equal((await one(tokens.officeStaffA, id)).status, 403);
    assert.equal(await csv(tokens.officeStaffA, id), 403);
  });

  it('switch on: own office, published only, no publisher name, other offices hidden', async () => {
    const mine = await insert(OFFICE_A, 'PUBLISHED', '2026-10-01');
    const draft = await insert(OFFICE_A, 'DRAFT', '2026-11-01');
    const other = await insert(OFFICE_B, 'PUBLISHED', '2026-10-02');
    switchState.STAFF_VIEW_REPORTS = true;
    const l = await list(tokens.officeStaffA);
    assert.equal(l.status, 200);
    assert.deepEqual(l.body.items.map((r) => r.report_id), [mine]);
    assert.equal((await one(tokens.officeStaffA, mine)).status, 200);
    assert.ok(!('published_by_name' in (await one(tokens.officeStaffA, mine)).body));
    assert.equal((await one(tokens.officeStaffA, draft)).status, 404, 'a draft is not theirs to read');
    assert.equal((await one(tokens.officeStaffA, other)).status, 404);
    assert.equal((await list(tokens.officeStaffA, `?office_id=${OFFICE_B}`)).status, 403);
    assert.equal(await csv(tokens.officeStaffA, mine), 200);
  });

  it('switch on never lets staff generate or publish', async () => {
    switchState.STAFF_VIEW_REPORTS = true;
    const draft = await insert(OFFICE_A, 'DRAFT', '2026-11-01');
    assert.equal((await call(generateRoute, req('POST', '/reports', { token: tokens.officeStaffA, body: { officeId: OFFICE_A } }))).status, 403);
    assert.equal((await call(publishRoute, req('POST', `/reports/${draft}/publish`, { token: tokens.officeStaffA, body: { confirm: true } }), { params: { id: draft } })).status, 403);
  });

  it('Identity unreachable (the real gate): staff are refused', async () => {
    const { createSwitchGate } = await import('ccms-shared');
    const { setSwitchGate } = await import('../src/lib/switches.js');
    setSwitchGate(createSwitchGate({ env: { IDENTITY_URL: 'http://127.0.0.1:9', SERVICE_KEY: 'k' }, timeoutMs: 300 }));
    try { assert.equal((await list(tokens.officeStaffA)).status, 403); } finally { setSwitchGate({ all: async () => ({ ...switchState }), isEnabled: async (k) => switchState[k] === true, reset() {} }); }
  });

  it('the Executive and Office Head are not decided by the switch', async () => {
    await insert(OFFICE_A, 'PUBLISHED', '2026-10-01');
    assert.equal((await list(tokens.executive)).status, 200);
    assert.equal((await list(tokens.officeHeadA)).status, 200);
  });
});
