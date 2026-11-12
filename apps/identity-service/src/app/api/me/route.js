import { ROLE_LIST, json, route } from 'ccms-shared';
import { getMe } from '../../../lib/me.js';
import { getDb } from '../../../lib/data-source.js';
import { guard } from '../../../lib/guard.js';

export const dynamic = 'force-dynamic';
const anyRole = guard(ROLE_LIST);

// GET /me — every signed-in role: their own account details and "What I can do".
export const GET = route(async (request) => {
  const user = await anyRole(request);
  return json(await getMe(await getDb(), user), 200, { 'cache-control': 'no-store' });
});
