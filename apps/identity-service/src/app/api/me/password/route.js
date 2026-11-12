import { ROLE_LIST, clientIp, json, readJson, route } from 'ccms-shared';
import { changeOwnPassword } from '../../../../lib/me.js';
import { readRefreshToken } from '../../../../lib/cookies.js';
import { getDb } from '../../../../lib/data-source.js';
import { guard } from '../../../../lib/guard.js';

export const dynamic = 'force-dynamic';
// An Executive may change their own password: this is not a data write, so the read-only rule is skipped (selfService).
const anyRole = guard(ROLE_LIST, 'campus', { selfService: true });

// PUT /me/password { current_password, new_password } — the caller's own password only.
export const PUT = route(async (request) => {
  const user = await anyRole(request);
  await changeOwnPassword(await getDb(), user, await readJson(request), { ipAddress: clientIp(request), keepRefreshToken: await readRefreshToken(request) });
  return json({ ok: true }, 200, { 'cache-control': 'no-store' });
});
