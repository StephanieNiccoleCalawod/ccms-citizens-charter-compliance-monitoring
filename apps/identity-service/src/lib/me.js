import { Errors, ROLE_LABELS, capabilitiesFor, recordAudit } from 'ccms-shared';
import { Account } from './entities/index.js';
import { toAccountDto } from './accounts.js';
import { NO_PASSWORD_MARKER } from './accounts.js';
import { readSwitchValues } from './permission-switches.js';
import { kickOutbox } from './outbox.js';
import { hashPassword, passwordProblem, verifyPassword } from './passwords.js';
import { hashToken } from './tokens.js';
import { policyForRole } from './session-policy.js';

const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);

/** GET /me: the caller's own account and "What I can do", built from the same rule table as the Roles and permissions matrix. */
export async function getMe(db, user) {
  const account = await db.getRepository(Account).findOneBy({ accountId: user.id });
  if (!account || !account.isActive) throw Errors.unauthorized('Your session has ended. Please sign in again.', 'SESSION_ENDED');
  const dto = toAccountDto(account);
  const [login] = rowsOf(await db.query('SELECT last_login_at FROM account_last_login WHERE account_id = $1', [user.id]));
  const switches = await readSwitchValues(db);
  return {
    account: {
      account_id: dto.account_id, employee_no: dto.employee_no, full_name: dto.full_name, email: dto.email, role: dto.role,
      role_label: ROLE_LABELS[dto.role] ?? dto.role, office_id: dto.office_id, position: dto.position,
      last_login_at: login?.last_login_at ?? null,
    },
    what_i_can_do: capabilitiesFor(dto.role, switches).map(({ key, group, label, access, switchKey, switchOn }) => ({ key, group, label, access, switch_key: switchKey, switch_on: switchOn })),
    sign_in: await signInMethods(db, account),
    session_policy: policyForRole(dto.role),
  };
}

/** Called after a successful sign-in. */
export async function recordLogin(db, accountId) {
  await db.query(
    `INSERT INTO account_last_login (account_id, last_login_at) VALUES ($1, now())
     ON CONFLICT (account_id) DO UPDATE SET last_login_at = EXCLUDED.last_login_at`,
    [accountId],
  );
}

/** PUT /me/password { current_password, new_password }: the caller's own password. Other sessions end (the one in use stays signed in). Audited without any password value. */
export async function changeOwnPassword(db, user, body, { ipAddress, keepRefreshToken } = {}) {
  const current = body?.current_password;
  const next = body?.new_password;
  const details = {};
  if (typeof current !== 'string' || !current) details.current_password = 'Enter your current password.';
  const problem = passwordProblem(next);
  if (problem) details.new_password = problem;
  else if (next === current) details.new_password = 'Choose a password different from the current one.';
  if (Object.keys(details).length) throw Errors.validation('Please correct the highlighted fields', details);

  const account = await db.getRepository(Account).findOneBy({ accountId: user.id });
  if (!account || !account.isActive) throw Errors.unauthorized('Your session has ended. Please sign in again.', 'SESSION_ENDED');
  if (!(await verifyPassword(current, account.passwordHash))) throw Errors.validation('Please correct the highlighted fields', { current_password: 'The current password is not correct.' });
  const passwordHash = await hashPassword(next);
  await db.transaction(async (manager) => {
    await manager.query('UPDATE accounts SET password_hash = $2, updated_at = now() WHERE account_id = $1', [user.id, passwordHash]);
    await manager.query('UPDATE refresh_tokens SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR token_hash <> $2)', [user.id, keepRefreshToken ? hashToken(keepRefreshToken) : null]);
    await recordAudit(manager, {
      actor: user, action: 'PASSWORD_CHANGED', entityType: 'account', entityId: user.id, entityName: account.fullName,
      officeId: account.officeId, before: null, after: null, ipAddress,
    });
  });
  kickOutbox();
}

/**
 * S8-04: how this account can sign in, for the My Account page. Only yes/no answers: no hash, Clerk ID, email or token. `clerk_linked` is
 * null when it could not be read, so a problem here never stops /me from answering.
 */
async function signInMethods(db, account) {
  let clerkLinked = null;
  try {
    clerkLinked = rowsOf(await db.query('SELECT 1 FROM account_clerk_links WHERE account_id = $1 LIMIT 1', [account.accountId])).length > 0;
  } catch {
    clerkLinked = null;
  }
  return { clerk_linked: clerkLinked, has_password: Boolean(account.passwordHash) && account.passwordHash !== NO_PASSWORD_MARKER };
}
