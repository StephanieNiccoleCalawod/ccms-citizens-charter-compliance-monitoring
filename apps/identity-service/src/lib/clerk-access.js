import { createHash, randomBytes } from 'node:crypto';
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
 * the Super Admin) or ACCOUNT_INACTIVE. With Flow A on (`invitations` = { settings, api }), a person who is not bound yet
 * but signed up through a CCCMS invitation is bound first, from the reference in their Clerk public metadata.
 */
export async function exchangeClerkSession(db, identity, { invitations = null } = {}) {
  let [link] = rowsOf(
    await db.query('SELECT account_id FROM account_clerk_links WHERE clerk_issuer = $1 AND clerk_user_id = $2', [identity.issuer, identity.subject]),
  );
  if (!link && invitations) {
    link = await linkFromInvitation(db, identity, invitations.settings, invitations.api);
    if (link) kickOutbox();
  }
  // S8-45 (CLERK_REQUIRE_INVITATION): someone CCCMS never invited or registered (for example a user of another system on the shared
  // Clerk sign-in) is refused here, before any access request is stored. A failing lookup throws, so it never lets anyone in.
  if (!link && config.clerkRequireInvitation && !(await isKnownToCccms(db, identity, { invitations: Boolean(invitations) }))) {
    throw Errors.forbidden(NOT_INVITED_MESSAGE, 'NOT_INVITED');
  }
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

/**
 * Super Admin: which accounts are bound to Clerk, with the account's name, employee number and whether it is still active
 * (a deactivated account keeps its binding but cannot sign in: the screen shows it as Deactivated). No Clerk IDs or emails.
 * `directory` says whether Flow B (find a person in Clerk by the account's email) is switched on.
 */
export async function listLinks(db, settings, { directory = false, invitations = false } = {}) {
  const rows = rowsOf(
    await db.query(
      `SELECT l.account_id, l.linked_at, l.linked_by, a.full_name, a.employee_no, a.is_active
         FROM account_clerk_links l LEFT JOIN accounts a ON a.account_id = l.account_id
        WHERE l.clerk_issuer = $1 ORDER BY l.linked_at DESC`,
      [settings.issuer],
    ),
  );
  // Flow A: open invitations (only read while the switch is on, so the table is not needed before its migration).
  const invited = invitations
    ? rowsOf(
        await db.query(
          'SELECT account_id, invited_at FROM clerk_invitations WHERE clerk_issuer = $1 AND used_at IS NULL AND revoked_at IS NULL ORDER BY invited_at DESC',
          [settings.issuer],
        ),
      ).map((r) => ({ account_id: r.account_id, invited_at: r.invited_at }))
    : [];
  return {
    directory,
    invitations,
    invited,
    items: rows.map((r) => ({
      account_id: r.account_id,
      linked_at: r.linked_at,
      linked_by: r.linked_by,
      full_name: r.full_name ?? null,
      employee_no: r.employee_no ?? null,
      is_active: r.is_active === true,
    })),
  };
}

/**
 * Flow B, step 1 (Super Admin): does the person behind this CCMS account already have a Clerk login? Looks up the
 * account's own email in Clerk (one exact address, R6) and returns the people whose VERIFIED email matches. Nothing is
 * bound yet: the Super Admin confirms one in step 2.
 */
export async function findClerkUserForAccount(db, accountId, settings, directory, lookup) {
  if (!isUuid(accountId)) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  const account = await db.getRepository(Account).findOneBy({ accountId });
  if (!account) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  if (!account.isActive) throw Errors.conflict('Reactivate the account before linking it', 'ACCOUNT_INACTIVE');
  const [taken] = rowsOf(await db.query('SELECT 1 FROM account_clerk_links WHERE account_id = $1', [accountId]));
  if (taken) throw Errors.conflict('This account is already linked. Remove the current link first.', 'ACCOUNT_ALREADY_LINKED');
  const people = await lookup.findUsersByEmail(directory, account.email);
  // Mark people who are already bound to another CCCMS account, so the screen does not offer them.
  const ids = people.map((p) => p.clerk_user_id);
  const linked = ids.length
    ? new Set(rowsOf(await db.query('SELECT clerk_user_id FROM account_clerk_links WHERE clerk_issuer = $1 AND clerk_user_id = ANY($2)', [settings.issuer, ids])).map((r) => r.clerk_user_id))
    : new Set();
  return {
    account_id: accountId,
    email: String(account.email).toLowerCase(),
    matches: people.map((p) => ({ ...p, already_linked: linked.has(p.clerk_user_id) })),
  };
}

/**
 * Flow B, step 2 (Super Admin): bind the account to a Clerk user found in step 1. Clerk is asked again for that user: it
 * must exist, not be banned or locked, and have a VERIFIED email equal to the account's email. The binding is still by
 * issuer + Clerk user ID (R3); the email check only proves it is the same person the Super Admin looked up.
 */
export async function linkAccountFromDirectory(db, actor, accountId, body, settings, directory, lookup, { ipAddress } = {}) {
  const clerkUserId = typeof body?.clerk_user_id === 'string' ? body.clerk_user_id.trim() : '';
  if (!SUBJECT_RE.test(clerkUserId)) {
    throw Errors.validation('Choose the person found in Clerk', { clerk_user_id: 'Must be a Clerk user ID (user_...)' });
  }
  if (!isUuid(accountId)) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  const preview = await db.getRepository(Account).findOneBy({ accountId });
  if (!preview) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');

  const user = await lookup.getUser(directory, clerkUserId);
  if (!user) throw Errors.conflict('This person was not found in Clerk.', 'CLERK_USER_NOT_FOUND');
  if (user.banned === true || user.locked === true) throw Errors.conflict('This Clerk login is banned or locked.', 'CLERK_USER_BLOCKED');
  if (!lookup.verifiedMatch(user, preview.email)) {
    throw Errors.conflict("This Clerk login does not have the account's email as a verified address.", 'CLERK_EMAIL_MISMATCH');
  }

  let result;
  try {
    result = await db.transaction(async (manager) => {
      const account = await loadActiveAccount(manager, accountId);
      const [taken] = rowsOf(await manager.query('SELECT 1 FROM account_clerk_links WHERE account_id = $1', [accountId]));
      if (taken) throw Errors.conflict('This account is already linked. Remove the current link first.', 'ACCOUNT_ALREADY_LINKED');
      const [saved] = rowsOf(
        await manager.query(
          `INSERT INTO account_clerk_links (account_id, clerk_issuer, clerk_user_id, linked_by) VALUES ($1, $2, $3, $4)
           RETURNING account_id, linked_at, linked_by`,
          [accountId, settings.issuer, clerkUserId, actor.id],
        ),
      );
      // A pending sign-in by the same person is now answered.
      await manager.query('DELETE FROM clerk_access_requests WHERE clerk_issuer = $1 AND clerk_user_id = $2', [settings.issuer, clerkUserId]);
      await recordAudit(manager, {
        actor,
        action: 'ACCOUNT_CLERK_LINKED',
        entityType: 'account',
        entityId: accountId,
        entityName: account.fullName,
        officeId: account.officeId,
        before: null,
        after: { account_id: accountId, clerk_user_id: clerkUserId, via: 'directory' },
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


// ---------------------------------------------------------------------------------------------------------------------
// Flow A: invitations sent by CCCMS (Shared Clerk Access Playbook; review 11/17/2026 section 2, dev response section 5).
//   1. A Super Admin invites the person behind an existing, active, unlinked CCMS account. If that email already has a
//      verified Clerk login, Flow B ("Find in Clerk") is used instead. Clerk gets one opaque random reference under
//      public_metadata.cccms (R2); CCMS keeps only its SHA-256.
//   2. At the person's first sign-in the exchange reads the reference from their Clerk user (Backend API, decision "b") and
//      binds the account by issuer + Clerk user ID (R3) when ALL hold: the reference matches an open (unused, unrevoked)
//      invitation of this instance, the Clerk user has the invited email as a VERIFIED address and is not banned or locked,
//      the account is still active and not linked, and the Clerk user is not linked elsewhere. The reference is then used
//      up (one time only). Any other app holding the instance key could write public_metadata.cccms, which is why the
//      reference alone is not trusted: it must match a row CCCMS created and is usable once.
//   3. A Super Admin can revoke an open invitation; only CCCMS's own (R5). Nothing else in Clerk is ever changed (R4).

const hashRef = (ref) => createHash('sha256').update(ref).digest('hex');

async function openInvitationFor(db, accountId, issuer) {
  const [row] = rowsOf(
    await db.query(
      'SELECT clerk_invitation_id, invited_at FROM clerk_invitations WHERE account_id = $1 AND clerk_issuer = $2 AND used_at IS NULL AND revoked_at IS NULL',
      [accountId, issuer],
    ),
  );
  return row ?? null;
}

/** Super Admin: send a Clerk invitation for an existing CCMS account. */
export async function sendClerkInvitation(db, actor, accountId, settings, invitations, api, { ipAddress } = {}) {
  if (!isUuid(accountId)) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  const account = await db.getRepository(Account).findOneBy({ accountId });
  if (!account) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  if (!account.isActive) throw Errors.conflict('Reactivate the account before inviting this person', 'ACCOUNT_INACTIVE');
  const [taken] = rowsOf(await db.query('SELECT 1 FROM account_clerk_links WHERE account_id = $1', [accountId]));
  if (taken) throw Errors.conflict('This account is already linked to Clerk.', 'ACCOUNT_ALREADY_LINKED');
  if (await openInvitationFor(db, accountId, settings.issuer)) {
    throw Errors.conflict('An invitation is already waiting for this account. Revoke it first to send a new one.', 'CLERK_INVITATION_OPEN');
  }
  // An existing Clerk login is linked with Flow B, never invited again (Clerk refuses invitations for existing users).
  if ((await api.findUsersByEmail(invitations, account.email)).length) {
    throw Errors.conflict('This email already has a Clerk login. Use "Find in Clerk" to link it.', 'CLERK_USER_EXISTS');
  }

  const ref = randomBytes(32).toString('base64url');
  const clerkInvitationId = await api.createInvitation(invitations, { email: account.email, ref });
  let saved;
  try {
    saved = await db.transaction(async (manager) => {
      const [row] = rowsOf(
        await manager.query(
          `INSERT INTO clerk_invitations (clerk_invitation_id, account_id, clerk_issuer, ref_hash, email, invited_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING invited_at`,
          [clerkInvitationId, accountId, settings.issuer, hashRef(ref), String(account.email).toLowerCase(), actor.id],
        ),
      );
      await recordAudit(manager, {
        actor,
        action: 'ACCOUNT_CLERK_INVITED',
        entityType: 'account',
        entityId: accountId,
        entityName: account.fullName,
        officeId: account.officeId,
        before: null,
        after: { account_id: accountId, clerk_invitation_id: clerkInvitationId },
        ipAddress,
      });
      return row;
    });
  } catch (err) {
    // Clerk accepted but CCMS could not record it: revoke it, so no invitation exists that CCMS does not know about.
    await api.revokeInvitation(invitations, clerkInvitationId).catch(() => {});
    if (isUniqueViolation(err, 'clerk_invitations_open_uq')) {
      throw Errors.conflict('An invitation is already waiting for this account. Revoke it first to send a new one.', 'CLERK_INVITATION_OPEN');
    }
    throw err;
  }
  kickOutbox();
  return { account_id: accountId, invited_at: saved.invited_at };
}

/** Super Admin: revoke the open invitation of an account. CCMS stops honouring it first, whatever Clerk answers. */
export async function revokeClerkInvitation(db, actor, accountId, settings, invitations, api, { ipAddress } = {}) {
  if (!isUuid(accountId)) throw Errors.notFound('Account not found', 'ACCOUNT_NOT_FOUND');
  const open = await openInvitationFor(db, accountId, settings.issuer);
  if (!open) throw Errors.notFound('No invitation is waiting for this account', 'CLERK_INVITATION_NOT_FOUND');
  await db.transaction(async (manager) => {
    const [row] = rowsOf(
      await manager.query(
        'UPDATE clerk_invitations SET revoked_at = now() WHERE clerk_invitation_id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING clerk_invitation_id',
        [open.clerk_invitation_id],
      ),
    );
    if (!row) throw Errors.conflict('The invitation was used or revoked in the meantime. Refresh the list.', 'CLERK_INVITATION_CHANGED');
    const account = await manager.getRepository(Account).findOneBy({ accountId });
    await recordAudit(manager, {
      actor,
      action: 'ACCOUNT_CLERK_INVITATION_REVOKED',
      entityType: 'account',
      entityId: accountId,
      entityName: account?.fullName,
      officeId: account?.officeId ?? null,
      before: { account_id: accountId, clerk_invitation_id: open.clerk_invitation_id },
      after: null,
      ipAddress,
    });
  });
  kickOutbox();
  const { revokedInClerk } = await api.revokeInvitation(invitations, open.clerk_invitation_id).catch(() => ({ revokedInClerk: false }));
  return { account_id: accountId, revoked_in_clerk: revokedInClerk };
}

/**
 * Exchange helper: binds an unbound Clerk user from their Flow A reference, or returns null (the caller then records the
 * usual pending request). Clerk being unreachable also returns null: the person sees "No access yet" and "Check again"
 * retries. Never throws for a reference that does not qualify.
 */
async function linkFromInvitation(db, identity, invitations, api) {
  const [anyOpen] = rowsOf(
    await db.query('SELECT 1 FROM clerk_invitations WHERE clerk_issuer = $1 AND used_at IS NULL AND revoked_at IS NULL LIMIT 1', [identity.issuer]),
  );
  if (!anyOpen) return null; // no Clerk call while nothing is waiting
  let user;
  try {
    user = await api.getUser(invitations, identity.subject);
  } catch {
    return null;
  }
  const ref = api.invitationRefOf(user);
  if (!ref || user.banned === true || user.locked === true) return null;

  try {
    return await db.transaction(async (manager) => {
      const [invitation] = rowsOf(
        await manager.query(
          `SELECT clerk_invitation_id, account_id, email, invited_by FROM clerk_invitations
            WHERE ref_hash = $1 AND clerk_issuer = $2 AND used_at IS NULL AND revoked_at IS NULL FOR UPDATE`,
          [hashRef(ref), identity.issuer],
        ),
      );
      if (!invitation || !api.verifiedMatch(user, invitation.email)) return null;
      const account = await manager.getRepository(Account).findOneBy({ accountId: invitation.account_id });
      if (!account || !account.isActive) return null;
      const [taken] = rowsOf(await manager.query('SELECT 1 FROM account_clerk_links WHERE account_id = $1', [account.accountId]));
      if (taken) return null;
      await manager.query('INSERT INTO account_clerk_links (account_id, clerk_issuer, clerk_user_id, linked_by) VALUES ($1, $2, $3, $4)', [
        account.accountId,
        identity.issuer,
        identity.subject,
        invitation.invited_by,
      ]);
      await manager.query('UPDATE clerk_invitations SET used_at = now(), used_by_clerk_user_id = $2 WHERE clerk_invitation_id = $1', [
        invitation.clerk_invitation_id,
        identity.subject,
      ]);
      await manager.query('DELETE FROM clerk_access_requests WHERE clerk_issuer = $1 AND clerk_user_id = $2', [identity.issuer, identity.subject]);
      await recordAudit(manager, {
        actor: { id: account.accountId, role: account.roleKey },
        action: 'ACCOUNT_CLERK_LINKED',
        entityType: 'account',
        entityId: account.accountId,
        entityName: account.fullName,
        officeId: account.officeId,
        before: null,
        after: { account_id: account.accountId, clerk_user_id: identity.subject, via: 'invitation', invited_by: invitation.invited_by },
      });
      return { account_id: account.accountId };
    });
  } catch (err) {
    // The Clerk user is already bound elsewhere, or a parallel sign-in won: fall back to the normal answer.
    if (isUniqueViolation(err, 'account_clerk_links_subject_uq') || isUniqueViolation(err, 'account_clerk_links_pkey')) return null;
    throw err;
  }
}

export const NOT_INVITED_MESSAGE = 'This sign-in is not registered for CCCMS. Ask your CCCMS administrator for an invitation.';

/**
 * S8-45: is this Clerk person known to CCCMS? Yes when they already have a pending access request, or their email matches an open
 * CCCMS invitation (only looked at when invitations are switched on), or their email matches an active CCCMS account that is not
 * bound to anyone yet (the Super Admin created it for them). The email only decides whether a request may be recorded: it never
 * grants access. Nothing in Clerk is read or changed.
 */
export async function isKnownToCccms(db, identity, { invitations = false } = {}) {
  const [pending] = rowsOf(
    await db.query('SELECT 1 FROM clerk_access_requests WHERE clerk_issuer = $1 AND clerk_user_id = $2 LIMIT 1', [identity.issuer, identity.subject]),
  );
  if (pending) return true;
  const email = String(identity.email ?? '').trim().toLowerCase();
  if (!email) return false;
  if (invitations) {
    const [invited] = rowsOf(
      await db.query(
        'SELECT 1 FROM clerk_invitations WHERE clerk_issuer = $1 AND lower(email) = $2 AND used_at IS NULL AND revoked_at IS NULL LIMIT 1',
        [identity.issuer, email],
      ),
    );
    if (invited) return true;
  }
  const [registered] = rowsOf(
    await db.query(
      `SELECT 1 FROM accounts a
        WHERE lower(a.email) = $1 AND a.is_active = true
          AND NOT EXISTS (SELECT 1 FROM account_clerk_links l WHERE l.account_id = a.account_id)
        LIMIT 1`,
      [email],
    ),
  );
  return Boolean(registered);
}
