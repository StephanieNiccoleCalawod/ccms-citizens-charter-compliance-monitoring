import { Errors, ROLES, isUuid, json, requireServiceKey, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';

export const dynamic = 'force-dynamic';

// GET /internal/office-accounts?office_id= — service-to-service only (x-service-key); the gateway never forwards
// /api/internal. Sprint 6 TT1 (K17): the historical-records import reads the ACTIVE Office Head and Office Staff accounts
// of an office at run time, in a stable order (account_id), with the display name and position it copies as the Start
// snapshots. No email, employee number, password data or login state. Nothing is created or changed.
export const GET = route(async (request) => {
  requireServiceKey(request);
  const params = new URL(request.url).searchParams;
  const officeId = params.get('office_id');
  if (!isUuid(officeId) || [...params.keys()].some((key) => key !== 'office_id')) {
    throw Errors.validation('Give one office_id', { office_id: 'office_id must be a valid id' });
  }
  const items = await (await getDb()).query(
    `SELECT account_id, role_key AS role, full_name, position
       FROM accounts
      WHERE office_id = $1 AND is_active = true AND role_key IN ($2, $3)
      ORDER BY account_id`,
    [officeId, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF],
  );
  return json({ items }, 200, { 'cache-control': 'no-store' });
});
