import { json, route } from 'ccms-shared';
import { getSigningKeys } from '../../../../lib/tokens.js';

export const dynamic = 'force-dynamic';

// GET /auth/jwks — the public keys every other service uses to verify tokens offline (RS256).
export const GET = route(async () => {
  const { jwks } = await getSigningKeys();
  return json(jwks, 200, { 'cache-control': 'public, max-age=300' });
});
