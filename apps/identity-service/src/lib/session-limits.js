import { Errors } from 'ccms-shared';
import { config } from './config.js';
import { Account, RefreshToken } from './entities/index.js';
import { toAccountDto } from './accounts.js';
import { limitsFor } from './session-policy.js';
import { hashToken, newOpaqueToken, signAccessToken } from './tokens.js';

// S8-33 (BE), password sign-in, used only when SESSION_POLICY_ENABLED=true. No schema change:
//  - ABSOLUTE limit: the refresh token of a new sign-in expires at sign-in + the role's absolute limit, and every renewal keeps that same
//    expiry, so renewing can never extend the session.
//  - IDLE limit: a renewal is refused when the token being used is older than the role's idle limit. The browser must therefore renew only
//    when the person is active; polling alone must not renew (front-end work), otherwise it counts as activity.
// Role and office are read fresh from the account on each renewal; a deactivated account, a revoked token or a sign-out cannot renew.

function userFrom(account) {
  const dto = toAccountDto(account);
  return { id: dto.account_id, employee_no: dto.employee_no, full_name: dto.full_name, email: dto.email, role: dto.role, office_id: dto.office_id };
}

async function issue(manager, account, expiresAt) {
  const refreshToken = newOpaqueToken();
  await manager.getRepository(RefreshToken).save({ tokenHash: hashToken(refreshToken), accountId: account.accountId, expiresAt });
  return { accessToken: await signAccessToken(account), refreshToken, expiresIn: config.accessTokenSeconds, user: userFrom(account) };
}

/** A new sign-in: the refresh token lasts at most the role's absolute limit. */
export async function issueLimitedSession(dataSource, account) {
  const { absoluteMinutes } = limitsFor(account.roleKey);
  return issue(dataSource, account, new Date(Date.now() + absoluteMinutes * 60_000));
}

const ended = (message, code) => Errors.unauthorized(message, code);

/** Renews a session if it is not idle and not past its absolute limit. */
export async function refreshWithLimits(dataSource, refreshToken) {
  const invalid = () => ended('Your session has expired. Please sign in again.', 'INVALID_REFRESH_TOKEN');
  return dataSource.transaction(async (manager) => {
    const tokenHash = hashToken(refreshToken);
    const rows = await manager.query(
      `SELECT a.account_id, r.created_at, r.expires_at
         FROM refresh_tokens r JOIN accounts a ON a.account_id = r.account_id
        WHERE r.token_hash = $1 AND r.revoked_at IS NULL AND a.is_active = true
        FOR UPDATE OF r`,
      [tokenHash],
    );
    if (!rows.length) throw invalid();
    const account = await manager.getRepository(Account).findOneByOrFail({ accountId: rows[0].account_id });
    const { idleMinutes, absoluteMinutes } = limitsFor(account.roleKey);
    const now = Date.now();
    const expiresAt = new Date(rows[0].expires_at).getTime();
    const idleFor = now - new Date(rows[0].created_at).getTime();
    const stop = async () => manager.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [tokenHash]);
    if (expiresAt <= now) {
      await stop();
      throw ended('Your session reached its time limit. Please sign in again.', 'SESSION_TIME_LIMIT');
    }
    if (idleFor > idleMinutes * 60_000) {
      await stop();
      throw ended('You were signed out because of inactivity. Please sign in again.', 'SESSION_IDLE_TIMEOUT');
    }
    await stop();
    // Keep the original expiry. A session that began before the policy was switched on is capped once to a full absolute window from now.
    return issue(manager, account, new Date(Math.min(expiresAt, now + absoluteMinutes * 60_000)));
  });
}
