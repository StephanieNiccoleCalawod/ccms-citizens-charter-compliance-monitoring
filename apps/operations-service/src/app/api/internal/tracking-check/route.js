import { Errors, json, requireServiceKey, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';

export const dynamic = 'force-dynamic';

const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);

// GET /internal/tracking-check?tracking_no= — S8-56, service key only; the gateway never forwards /api/internal.
// Called by Oversight so a citizen can confirm a transaction before filing a complaint. Answers only whether the number exists and which
// office, service and day it belongs to: no client, staff, receipt or status details. Exact match after trimming and upper-casing.
export const GET = route(async (request) => {
  requireServiceKey(request);
  const raw = new URL(request.url).searchParams.get('tracking_no');
  const trackingNo = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!trackingNo || trackingNo.length > 60) throw Errors.validation('Enter a tracking number.', { tracking_no: 'Enter a tracking number.' });
  const rows = rowsOf(await (await getDb()).query(
    `SELECT office_id, office_name, service_name, started_at FROM transactions WHERE upper(tracking_no) = $1 ORDER BY started_at DESC LIMIT 1`,
    [trackingNo],
  ));
  if (!rows.length) return json({ found: false }, 200, { 'cache-control': 'no-store' });
  const row = rows[0];
  return json({ found: true, office_id: row.office_id, office_name: row.office_name, service_name: row.service_name, started_at: new Date(row.started_at).toISOString() }, 200, { 'cache-control': 'no-store' });
});
