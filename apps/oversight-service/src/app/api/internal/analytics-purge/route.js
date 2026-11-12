import { AppError, Errors, isSeededTrackingNo, isUuid, json, readBoundedJson, requireServiceKey, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 500;
const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);

// POST /internal/analytics-purge — Sprint 6 TT1, service key only; the gateway never forwards /api/internal.
// Removes SEEDED rows (tracking number 9001-9999, K16) from analytics_transactions and tombstones their ids so a late live
// event, a replay or a backfill page can never restore them. Called only by Operations' scripts/seed-transactions.js
// during --remove or a replacement, after Operations has deleted its own rows. Off unless ANALYTICS_SEED_PURGE=enabled
// (set it on the demo deployment only). Body { items: [{ transaction_id, tracking_no }] }, at most 500.
// 200 { purged, tombstoned }; 409 SEED_PURGE_REFUSED and nothing changed when any id is a live (not seeded) row.
// Repeating a call is safe (already-tombstoned ids are counted as 0).
export const POST = route(async (request) => {
  requireServiceKey(request);
  if (process.env.ANALYTICS_SEED_PURGE !== 'enabled') throw Errors.forbidden('Seeded-history purge is not enabled on this deployment', 'SEED_PURGE_DISABLED');
  const body = await readBoundedJson(request);
  const items = body?.items;
  const keys = body && typeof body === 'object' ? Object.keys(body) : [];
  if (!Array.isArray(items) || items.length > MAX_ITEMS || keys.some((key) => key !== 'items')) {
    throw Errors.validation('Send { items: [...] } with at most 500 items');
  }
  const ids = [];
  for (const [index, item] of items.entries()) {
    const ok = item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).every((key) => ['transaction_id', 'tracking_no'].includes(key))
      && isUuid(item.transaction_id) && typeof item.tracking_no === 'string' && isSeededTrackingNo(item.tracking_no);
    if (!ok) throw Errors.validation('Only seeded transactions (tracking number 9001-9999) can be purged', { [`items.${index}`]: 'Not a seeded transaction' });
    ids.push(item.transaction_id.toLowerCase());
  }
  const [result] = rowsOf(await (await getDb()).query('SELECT purged, tombstoned, refused FROM purge_seeded_analytics($1::uuid[])', [ids]));
  if (result.refused > 0) {
    throw new AppError(409, 'SEED_PURGE_REFUSED', 'Some ids belong to live (not seeded) analytics rows. Nothing was removed.', { refused: result.refused });
  }
  return json({ purged: result.purged, tombstoned: result.tombstoned }, 200, { 'cache-control': 'no-store' });
});
