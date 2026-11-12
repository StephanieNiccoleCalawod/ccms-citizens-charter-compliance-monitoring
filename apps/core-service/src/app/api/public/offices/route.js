import { json, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { limitPublicRequest } from '../../../../lib/catalogue/public-catalogue.js';

export const dynamic = 'force-dynamic';

// GET /public/offices — no login, rate limited. The active offices (id, code, name) for the public complaint form (CC032).
// Nothing else about an office is public.
export const GET = route(async (request, { correlationId }) => {
  const limited = await limitPublicRequest(request, correlationId);
  if (limited) return limited;
  const rows = await (await getDb()).query('SELECT office_id, office_code, office_name FROM offices WHERE is_active = true ORDER BY lower(office_name)');
  return json({ items: rows }, 200, { 'cache-control': 'public, max-age=60' });
});
