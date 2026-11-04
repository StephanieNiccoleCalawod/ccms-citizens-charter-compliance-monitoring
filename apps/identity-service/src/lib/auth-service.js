import { Errors } from 'ccms-shared';
import { config } from './config.js';
import { Account, RefreshToken } from './entities/index.js';
import { toAccountDto } from './accounts.js';
import { hashToken, newOpaqueToken, signAccessToken } from './tokens.js';
import { verifyAgainstDummy, verifyPassword } from './passwords.js';

const BAD_CREDENTIALS = 'Incorrect email or password';

function userFrom(account) {
  const dto = toAccountDto(account);
  return { id: dto.account_id, employee_no: dto.employee_no, full_name: dto.full_name, email: dto.email, role: dto.role, office_id: dto.office_id };
}

async function issueSession(dataSource, account) {
  const refreshToken = newOpaqueToken();
  await dataSource.getRepository(RefreshToken).save({
    tokenHash: hashToken(refreshToken),
    accountId: account.accountId,
    expiresAt: new Date(Date.now() + config.refreshTokenDays * 86_400_000),
  });
  return {
    accessToken: await signAccessToken(account),
    refreshToken,
    expiresIn: config.accessTokenSeconds,
    user: userFrom(account),
  };
}

/**
 * Wrong password, unknown email and deactivated account all look identical to the caller and
 * take similar time. Sign-in and sign-out are not written to the audit trail (it records changes).
 * The login route applies the shared failure limiter before calling this credential check.
 */
export async function login(dataSource, { email, password }) {
  const fail = () => Errors.unauthorized(BAD_CREDENTIALS, 'INVALID_CREDENTIALS');
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    await verifyAgainstDummy(String(password ?? ''));
    throw fail();
  }
  const account = await dataSource.getRepository(Account).createQueryBuilder('a').where('lower(a.email) = :email', { email: email.trim().toLowerCase() }).getOne();
  if (!account) {
    await verifyAgainstDummy(password);
    throw fail();
  }
  const passwordOk = await verifyPassword(password, account.passwordHash);
  if (!passwordOk || !account.isActive) throw fail();
  return issueSession(dataSource, account);
}

/** Atomically rotates a valid refresh token. Role and office are read fresh from the account. */
export async function refresh(dataSource, refreshToken) {
  const fail = () => Errors.unauthorized('Your session has expired. Please sign in again.', 'INVALID_REFRESH_TOKEN');
  if (!refreshToken) throw fail();
  return dataSource.transaction(async (manager) => {
    const rows = await manager.query(
      `SELECT a.account_id FROM refresh_tokens r JOIN accounts a ON a.account_id = r.account_id
        WHERE r.token_hash = $1 AND r.revoked_at IS NULL AND r.expires_at > now() AND a.is_active = true
        FOR UPDATE OF r`,
      [hashToken(refreshToken)],
    );
    if (!rows.length) throw fail();

    await manager.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hashToken(refreshToken)]);
    const account = await manager.getRepository(Account).findOneByOrFail({ accountId: rows[0].account_id });
    return issueSession(manager, account);
  });
}

/** Revokes the refresh token so the session cannot be continued. Safe to call twice. */
export async function logout(dataSource, refreshToken) {
  if (!refreshToken) return;
  await dataSource.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(refreshToken)]);
}
