import { json, requireServiceKey, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { readSwitchValues } from '../../../../lib/permission-switches.js';

export const dynamic = 'force-dynamic';

// GET /internal/permission-switches — service-to-service only (x-service-key; the gateway never forwards /api/internal).
// Operations and Oversight read the four values, keep them for at most 10 seconds, and treat an unreachable Identity as all off.
export const GET = route(async (request) => {
  requireServiceKey(request);
  return json({ switches: await readSwitchValues(await getDb()) }, 200, { 'cache-control': 'no-store' });
});
