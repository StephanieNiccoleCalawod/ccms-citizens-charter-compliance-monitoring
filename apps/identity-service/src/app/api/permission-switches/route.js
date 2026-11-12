import { ROLES, clientIp, json, readJson, route } from 'ccms-shared';
import { getDb } from '../../../lib/data-source.js';
import { guard } from '../../../lib/guard.js';
import { getSwitchesView, updateSwitches } from '../../../lib/permission-switches.js';

export const dynamic = 'force-dynamic';
const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// GET /permission-switches — Super Admin only: the four switches and the full role matrix (read-only).
export const GET = route(async (request) => {
  await superAdminOnly(request);
  return json(await getSwitchesView(await getDb()), 200, { 'cache-control': 'no-store' });
});

// PUT /permission-switches — Super Admin only; { switches: { KEY: true|false } }; only the four keys; audited before and after.
export const PUT = route(async (request) => {
  const user = await superAdminOnly(request);
  return json(await updateSwitches(await getDb(), user, await readJson(request), { ipAddress: clientIp(request) }), 200, { 'cache-control': 'no-store' });
});
