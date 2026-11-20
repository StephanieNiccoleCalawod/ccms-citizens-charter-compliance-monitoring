import { Errors, ROLES, isUuid, recordAudit } from 'ccms-shared';
import { NO_PASSWORD_MARKER } from './accounts.js';
import { kickOutbox } from './outbox.js';

// S8-29 / S8-30 (D8-02: Clerk only). Two tools for moving accounts to Clerk. Neither changes a schema; account_id never changes.
//  - inventoryAccounts: read-only list of every account and how it signs in today (no emails, no names: only the email domain).
//  - cutoverAccount: for ONE account that is already linked to its Clerk user, stop the old CCCMS password and the old sessions.
//    Dry run unless apply is true. Never touches accounts that are not linked, inactive accounts, or the last working Super Admin access.
const rows = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);
const domainOf = (email) => String(email ?? '').split('@')[1]?.toLowerCase() ?? '';
const RESERVED = /(^|\.)(test|example|invalid|localhost)$|^example\.(com|org|net)$/;

/** What the PM needs to decide who is a real owner (D8-03). `provenance` stays a decision, so it is never guessed here. */
export async function inventoryAccounts(db) {
  const list = rows(await db.query(`
    SELECT a.account_id, a.role_key, a.office_id, a.is_active, a.email, a.password_hash,
           (l.account_id IS NOT NULL) AS clerk_linked,
           (SELECT count(*)::int FROM refresh_tokens r WHERE r.account_id = a.account_id AND r.revoked_at IS NULL AND r.expires_at > now()) AS live_sessions,
           ll.last_login_at
      FROM accounts a
      LEFT JOIN account_clerk_links l ON l.account_id = a.account_id
      LEFT JOIN account_last_login ll ON ll.account_id = a.account_id
     ORDER BY a.role_key, a.created_at`));
  return list.map((r) => {
    const hasPassword = Boolean(r.password_hash) && r.password_hash !== NO_PASSWORD_MARKER;
    const domain = domainOf(r.email);
    const sign_in = r.clerk_linked ? (hasPassword ? 'clerk_and_password' : 'clerk_only') : (hasPassword ? 'password_only' : 'no_sign_in');
    return {
      account_id: r.account_id, role: r.role_key, office_id: r.office_id, active: r.is_active,
      email_domain: domain, reserved_test_domain: RESERVED.test(domain),
      sign_in, live_sessions: r.live_sessions, last_login_at: r.last_login_at,
      next_step: !r.is_active ? 'inactive: leave deactivated' : sign_in === 'clerk_only' ? 'done' : sign_in === 'clerk_and_password' ? 'ready for cutover' : sign_in === 'password_only' ? 'link to the owner\'s Clerk user first (invite or Pending approval)' : 'no way to sign in',
      provenance: 'PM TO DECIDE (D8-03): real owner / shared demo / seed-only',
    };
  });
}

export function summarize(inventory) {
  const by = {};
  for (const r of inventory) { const key = `${r.role} | ${r.active ? 'active' : 'inactive'} | ${r.sign_in}`; by[key] = (by[key] ?? 0) + 1; }
  return by;
}

/** Super Admins who can sign in through Clerk right now (active and linked). The cutover never leaves fewer than two. */
async function workingClerkSuperAdmins(db, { except } = {}) {
  const found = rows(await db.query(
    `SELECT a.account_id FROM accounts a JOIN account_clerk_links l ON l.account_id = a.account_id WHERE a.role_key = $1 AND a.is_active`, [ROLES.SUPER_ADMIN]));
  return found.filter((r) => r.account_id !== except).length;
}

/**
 * Plan (apply=false) or do (apply=true) the cutover of one account: revoke its refresh tokens, void unused reset links and set the
 * no-password marker so the old password fails. Audited with who did it. The old password cannot be restored: rollback is a
 * Super Admin password reset (or unlinking from Clerk), as written in the runbook.
 */
export async function cutoverAccount(db, accountId, { actor, apply = false, ipAddress } = {}) {
  if (!isUuid(accountId)) throw Errors.validation('Account ID is not valid.', { account_id: 'Use the account UUID.' });
  const run = async (manager) => {
    const account = rows(await manager.query('SELECT account_id, role_key, office_id, is_active, password_hash FROM accounts WHERE account_id = $1 FOR UPDATE', [accountId]))[0];
    if (!account) throw Errors.notFound('Account not found.');
    if (!account.is_active) throw Errors.conflict('This account is deactivated. Leave it as it is.', 'ACCOUNT_INACTIVE');
    const link = rows(await manager.query('SELECT 1 FROM account_clerk_links WHERE account_id = $1', [accountId]))[0];
    if (!link) throw Errors.conflict('This account is not linked to a Clerk user yet. Link it first, or the owner would be locked out.', 'NOT_LINKED');
    if (account.role_key === ROLES.SUPER_ADMIN && (await workingClerkSuperAdmins(manager, { except: null })) < 2) {
      throw Errors.conflict('At least two active Super Admins must be linked to Clerk before any Super Admin is cut over.', 'TWO_SUPER_ADMINS_REQUIRED');
    }
    const hadPassword = account.password_hash !== NO_PASSWORD_MARKER;
    const live = rows(await manager.query('SELECT count(*)::int AS n FROM refresh_tokens WHERE account_id = $1 AND revoked_at IS NULL', [accountId]))[0].n;
    const plan = { account_id: accountId, role: account.role_key, had_password: hadPassword, refresh_tokens_to_revoke: live, applied: false };
    if (!apply) return plan;
    if (!actor) throw Errors.validation('An actor (Super Admin account) is required to apply.', { actor: 'Missing.' });
    await manager.query('UPDATE refresh_tokens SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [accountId]);
    await manager.query('UPDATE password_reset_tokens SET used_at = now() WHERE account_id = $1 AND used_at IS NULL', [accountId]);
    await manager.query('UPDATE accounts SET password_hash = $2, updated_at = now() WHERE account_id = $1', [accountId, NO_PASSWORD_MARKER]);
    await recordAudit(manager, {
      actor, action: 'ACCOUNT_CLERK_CUTOVER', entityType: 'account', entityId: accountId, officeId: account.office_id,
      before: { account_id: accountId, had_password: hadPassword, live_sessions: live },
      after: { account_id: accountId, had_password: false, live_sessions: 0, sign_in: 'clerk_only' }, ipAddress,
    });
    return { ...plan, applied: true };
  };
  const result = apply ? await db.transaction(run) : await run(db);
  if (result.applied) kickOutbox();
  return result;
}
