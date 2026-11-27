import { json, requireServiceKey, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { readSwitchValues, readSwitchValuesForOffice } from '../../../../lib/permission-switches.js';

export const dynamic = 'force-dynamic';

// GET /internal/permission-switches[?office_id=] — service-to-service only (x-service-key; the gateway never forwards /api/internal).
// Operations and Oversight read the four effective values (for the caller's office when office_id is passed), keep them for at most
// 10 seconds, and treat an unreachable Identity as all off.
export const GET = route(async (request) => {
  requireServiceKey(request);
  const officeId = new URL(request.url).searchParams.get('office_id');
  const db = await getDb();
  const switches = officeId ? await readSwitchValuesForOffice(db, officeId) : await readSwitchValues(db);
  return json({ switches }, 200, { 'cache-control': 'no-store' });
});
