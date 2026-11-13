import { Errors, isUniqueViolation, isUuid, recordAudit } from 'ccms-shared';
import { config } from './config.js';
import { toAccountDto } from './accounts.js';
import { Account } from './entities/index.js';
import { recordLogin } from './me.js';
import { kickOutbox } from './outbox.js';
import { signAccessToken } from './tokens.js';

// Clerk sign-in (Landas 1), following the Shared Clerk Access Playbook:
//   R1  roles stay in the CCMS accounts table; nothing is written to Clerk.
//   R3  an account is bound by Clerk issuer + user ID (sub). A matching email never grants access: the Super Admin binds a
//       specific person who has already signed in, and the email is only shown as a hint.
//   R4  nothing in Clerk is changed; removing access is CCMS-only (deactivate the account or remove the binding).
// The exchange issues the usual CCMS access token (15 minutes by default) and no refresh token: the browser asks again with
// a fresh Clerk token, so a CCMS session never outlives the Clerk session by more than one access token.

export const NO_ACCESS_YET = 'No access yet. Ask your CCMS administrator to approve your account.';
const ACCESS_OFF = 'Your CCMS access is turned off. Ask your CCMS administrator.';
const SUBJECT_RE = /^user_[A-Za-z0-9]+$/;
const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);

function userFrom(account) {
  const dto = toAccountDto(account);
  return { id: dto.account_id, employee_no: dto.employee_no, full_name: dto.full_name, email: dto.email, role: dto.role, office_id: dto.office_id };
}

/**
 * The verified Clerk identity ({ issuer, subject, email }) -> a CCMS session, or 403 with CCMS_ACCESS_PENDING (recorded for
 * the Super Admin) or ACCOUNT_INACTIVE.
 */
export async function exchangeClerkSession(db, identity) {
  const [link] = rowsOf(
    await db.query('SELECT account_id FROM account_clerk_links WHERE clerk_issuer = $1 AND clerk_user_id = $2', [identity.issuer, identity.subject]),
  );
  if (!link) {
    await db.query(
      `INSERT INTO clerk_access_requests (clerk_issuer, clerk_user_id, email) VALUES ($1, $2, $3)
       ON CONFLICT (clerk_issuer, clerk_user_id) DO UPDATE SET email = EXCLUDED.email, last_seen_at = now()`,
      [identity.issuer, identity.subject, identity.email],
    );
    throw Errors.forbidden(NO_ACCESS_YET, 'CCMS_ACCESS_PENDING');
  }
  const account = await db.getRepository(Account).findOneBy({ accountId: link.account_id });
  if (!account || !account.isActive) throw Errors.forbidden(ACCESS_OFF, 'ACCOUNT_INACTIVE');
  await recordLogin(db, account.accountId);
  return { accessToken: await signAccessToken(account), expiresIn: config.accessTokenSeconds, user: userFrom(account) };
}

/** Super Admin: people who signed in with Clerk and are not bound yet, newest first, with an exact-email suggestion. */
export async function listAccessRequests(db, settings) {
  const rows = rowsOf(
    await db.query(
      `SELECT r.clerk_user_id, r.email, r.first_seen_at, r.last_seen_at, a.account_id AS suggested_account_id, a.full_name AS suggested_full_name
         FROM clerk_access_requests r
         LEFT JOIN accounts a
           ON r.email IS NOT NULL AND lower(a.email) = r.email AND a.is_active = true
          AND NOT EXISTS (SELECT 1 FROM account_clerk_links l WHERE l.account_id = a.account_id)
        WHERE r.clerk_issuer = $1
        ORDER BY r.last_seen_at DESC
        LIMIT 200`,
      [settings.issuer],
    ),
  );
  return {
    items: rows.map((r) => ({
      clerk_user_id: r.clerk_user_id,
      email: r.email,
      first_seen_at: r.first_seen_at,
      last_seen_at: r.last_seen_at,
      suggested_account: r.suggested_account_id ? { account_id: r.suggested_account_id, full_name: r.suggested_full_name } : null,
    })),
  };
}

/** Super Admin: which accounts are bound to Clerk (no Clerk IDs or emails; enough for the Accounts screen). */
export async function listLinks(db, settings) {
  const rows = rowsOf(
    await db.query('SELECT account_id, linked_at, linked_by FROM account_clerk_links WHERE clerk_issuer = $1 ORDER BY linked_at DESC', [settings.issuer]),
  );
  return { items: rows.map((r) => ({ account_id: r.account_id, linked_at: r.linked_at, linked_by: r.linked_by })) };
}

async function loadActiveAccount(manager, accountId) {
  if (!isUuid(accountId)) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  const account = await manager.getRepository(Account).findOneBy({ accountId });
  if (!account) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  if (!account.isActive) throw Errors.conflict('Reactivate the account before linking it', 'ACCOUNT_INACTIVE');
  return account;
}

/**
 * Super Admin binds an account to the Clerk user of a pending request (the person must have signed in once, so the Clerk
 * user ID is known to be real). One Clerk user per account and one account per Clerk user. Audited without any email.
 */
export async function linkAccount(db, actor, accountId, body, settings, { ipAddress } = {}) {
  const clerkUserId = typeof body?.clerk_user_id === 'string' ? body.clerk_user_id.trim() : '';
  if (!SUBJECT_RE.test(clerkUserId)) {
    throw Errors.validation('Choose a person from the pending sign-ins', { clerk_user_id: 'Must be a Clerk user ID (user_...)' });
  }
  let result;
  try {
    result = await db.transaction(async (manager) => {
      const account = await loadActiveAccount(manager, accountId);
      const [request] = rowsOf(
        await manager.query('SELECT clerk_user_id FROM clerk_access_requests WHERE clerk_issuer = $1 AND clerk_user_id = $2 FOR UPDATE', [settings.issuer, clerkUserId]),
      );
      if (!request) throw Errors.conflict('This person has not signed in yet, or the request was dismissed.', 'CLERK_REQUEST_NOT_FOUND');
      const [taken] = rowsOf(await manager.query('SELECT 1 FROM account_clerk_links WHERE account_id = $1', [accountId]));
      if (taken) throw Errors.conflict('This account is already linked. Remove the current link first.', 'ACCOUNT_ALREADY_LINKED');

      const [saved] = rowsOf(
        await manager.query(
          `INSERT INTO account_clerk_links (account_id, clerk_issuer, clerk_user_id, linked_by) VALUES ($1, $2, $3, $4)
           RETURNING account_id, linked_at, linked_by`,
          [accountId, settings.issuer, clerkUserId, actor.id],
        ),
      );
      await manager.query('DELETE FROM clerk_access_requests WHERE clerk_issuer = $1 AND clerk_user_id = $2', [settings.issuer, clerkUserId]);
      await recordAudit(manager, {
        actor,
        action: 'ACCOUNT_CLERK_LINKED',
        entityType: 'account',
        entityId: accountId,
        entityName: account.fullName,
        officeId: account.officeId,
        before: null,
        after: { account_id: accountId, clerk_user_id: clerkUserId },
        ipAddress,
      });
      return { account_id: saved.account_id, linked_at: saved.linked_at, linked_by: saved.linked_by };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'account_clerk_links_subject_uq')) {
      throw Errors.conflict('This person is already linked to another CCMS account.', 'CLERK_USER_ALREADY_LINKED');
    }
    if (isUniqueViolation(err, 'account_clerk_links_pkey')) {
      throw Errors.conflict('This account is already linked. Remove the current link first.', 'ACCOUNT_ALREADY_LINKED');
    }
    throw err;
  }
  kickOutbox();
  return result;
}

/** Super Admin removes a binding (CCMS only; the Clerk user is untouched). Nobody can remove their own. */
export async function unlinkAccount(db, actor, accountId, settings, { ipAddress } = {}) {
  if (!isUuid(accountId)) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  if (String(accountId) === String(actor.id)) throw Errors.conflict('You cannot remove your own Clerk sign-in.', 'CANNOT_UNLINK_SELF');
  await db.transaction(async (manager) => {
    const [removed] = rowsOf(
      await manager.query('DELETE FROM account_clerk_links WHERE account_id = $1 AND clerk_issuer = $2 RETURNING clerk_user_id', [accountId, settings.issuer]),
    );
    if (!removed) throw Errors.notFound('This account is not linked to Clerk', 'CLERK_LINK_NOT_FOUND');
    const account = await manager.getRepository(Account).findOneBy({ accountId });
    await recordAudit(manager, {
      actor,
      action: 'ACCOUNT_CLERK_UNLINKED',
      entityType: 'account',
      entityId: accountId,
      entityName: account?.fullName,
      officeId: account?.officeId ?? null,
      before: { account_id: accountId, clerk_user_id: removed.clerk_user_id },
      after: null,
      ipAddress,
    });
  });
  kickOutbox();
}

/** Super Admin dismisses a pending sign-in (no access was ever given; the person can sign in again to reappear). */
export async function dismissAccessRequest(db, clerkUserId, settings) {
  if (typeof clerkUserId !== 'string' || !SUBJECT_RE.test(clerkUserId)) throw Errors.notFound('Request not found', 'CLERK_REQUEST_NOT_FOUND');
  const [removed] = rowsOf(
    await db.query('DELETE FROM clerk_access_requests WHERE clerk_issuer = $1 AND clerk_user_id = $2 RETURNING clerk_user_id', [settings.issuer, clerkUserId]),
  );
  if (!removed) throw Errors.notFound('Request not found', 'CLERK_REQUEST_NOT_FOUND');
}
