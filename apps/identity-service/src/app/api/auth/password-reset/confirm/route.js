import { clientIp, json, readJson, route } from 'ccms-shared';
import { completePasswordReset } from '../../../../../lib/accounts.js';
import { getDb } from '../../../../../lib/data-source.js';

export const dynamic = 'force-dynamic';

// POST /auth/password-reset/confirm { token, new_password } — reached from the emailed link.
// Public on purpose: the single-use, time-limited token is the credential.
export const POST = route(async (request) => {
  const body = await readJson(request);
  await completePasswordReset(await getDb(), { token: body.token, newPassword: body.new_password }, { ipAddress: clientIp(request) });
  return json({ message: 'Your password has been reset. You can now sign in.' });
});
