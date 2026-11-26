import { Errors, isUuid, json, requireServiceKey, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';

export const dynamic = 'force-dynamic';

const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);
const MAX_ROWS = 5000;

// GET /internal/complaint-links?office_id= — S8-54, service key only; the gateway never forwards /api/internal.
// How many complaints name each tracking number of one office. Called by Operations for the per-person report ("complaints linked to
// their transactions"). Only the number and the count: no complaint text, no complainant, no status. office_id may be left out
// entirely for a Super Admin's all-offices Report by Person (S8-6x): every complaint counts then, not just one office's.
export const GET = route(async (request) => {
  requireServiceKey(request);
  const officeId = new URL(request.url).searchParams.get('office_id');
  if (officeId !== null && !isUuid(officeId)) throw Errors.validation('Send a valid office_id.', { office_id: 'Choose a valid office.' });
  const rows = rowsOf(await (await getDb()).query(
    `SELECT upper(trim(tracking_no)) AS tracking_no, count(*)::int AS n
       FROM complaints WHERE ($1::uuid IS NULL OR office_id = $1::uuid) AND tracking_no IS NOT NULL AND trim(tracking_no) <> ''
      GROUP BY upper(trim(tracking_no)) ORDER BY 1 LIMIT ${MAX_ROWS + 1}`, [officeId]));
  if (rows.length > MAX_ROWS) throw Errors.unavailable('Too many linked complaints to list at once.', 'COMPLAINT_LINKS_TOO_MANY');
  return json({ items: rows.map((r) => ({ tracking_no: r.tracking_no, count: r.n })) }, 200, { 'cache-control': 'no-store' });
});
