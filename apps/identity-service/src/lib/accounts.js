import { randomUUID } from 'node:crypto';
import { Errors, ROLES, ROLE_LIST, isOfficeBound, isUniqueViolation, isValidRole, isUuid, recordAudit } from 'ccms-shared';
import { config } from './config.js';
import { Account, PasswordResetToken } from './entities/index.js';
import { verifyOffice } from './offices-client.js';
import { sendPasswordResetEmail } from './mailer.js';
import { kickOutbox } from './outbox.js';
import { hashPassword, passwordProblem } from './passwords.js';
import { hashToken, newOpaqueToken } from './tokens.js';

export const MESSAGES = {
  emailTaken: 'Email already in use',
  employeeNoTaken: 'Employee number already in use',
  officeRequired: 'Office is required for Office Head and Office Staff',
  officeForbidden: 'Executive and Super Admin accounts cannot have an office',
  lastSuperAdmin: 'At least one active Super Admin is required',
  notFound: 'Account not found',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Account as returned by the API. Never includes the password hash. */
export function toAccountDto(account) {
  return {
    account_id: account.accountId,
    employee_no: account.employeeNo,
    full_name: account.fullName,
    email: account.email,
    role: account.roleKey,
    office_id: account.officeId ?? null,
    is_active: account.isActive,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  };
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Field and role/office rules shared by create (CC001) and edit (CC002).
 * Returns normalised values or throws a 400.
 */
export function parseAccountInput(body, { withPassword }) {
  const details = {};
  const employeeNo = text(body.employee_no);
  const fullName = text(body.full_name);
  const email = text(body.email).toLowerCase();
  const role = body.role;
  const officeId = text(body.office_id) || null;

  if (!employeeNo) details.employee_no = 'Employee number is required';
  else if (employeeNo.length > 50) details.employee_no = 'Employee number must be 50 characters or fewer';
  if (!fullName) details.full_name = 'Full name is required';
  else if (fullName.length > 200) details.full_name = 'Full name must be 200 characters or fewer';
  if (!email) details.email = 'Email is required';
  else if (!EMAIL_RE.test(email) || email.length > 254) details.email = 'Enter a valid email address';
  if (!role) details.role = 'Role is required';
  else if (!isValidRole(role)) details.role = `Role must be one of: ${ROLE_LIST.join(', ')}`;

  let password = null;
  if (withPassword) {
    password = body.password;
    const problem = passwordProblem(password);
    if (problem) details.password = problem;
  }

  if (Object.keys(details).length) throw Errors.validation('Please correct the highlighted fields', details);

  if (isOfficeBound(role) && !officeId) {
    throw Errors.validation(MESSAGES.officeRequired, { office_id: MESSAGES.officeRequired });
  }
  if (!isOfficeBound(role) && officeId) {
    throw Errors.validation(MESSAGES.officeForbidden, { office_id: MESSAGES.officeForbidden });
  }
  return { employeeNo, fullName, email, roleKey: role, officeId, password };
}

function conflictFor(err) {
  if (isUniqueViolation(err, 'accounts_email_lower_uq')) return Errors.conflict(MESSAGES.emailTaken, 'EMAIL_TAKEN', { email: MESSAGES.emailTaken });
  if (isUniqueViolation(err, 'accounts_employee_no_uq')) {
    return Errors.conflict(MESSAGES.employeeNoTaken, 'EMPLOYEE_NO_TAKEN', { employee_no: MESSAGES.employeeNoTaken });
  }
  return null;
}

async function assertUnique(manager, { email, employeeNo }, exceptId = null) {
  const rows = await manager.query(
    `SELECT email, employee_no FROM accounts
      WHERE (lower(email) = $1 OR employee_no = $2) AND ($3::uuid IS NULL OR account_id <> $3::uuid)`,
    [email, employeeNo, exceptId],
  );
  if (rows.some((r) => r.email.toLowerCase() === email)) {
    throw Errors.conflict(MESSAGES.emailTaken, 'EMAIL_TAKEN', { email: MESSAGES.emailTaken });
  }
  if (rows.length) {
    throw Errors.conflict(MESSAGES.employeeNoTaken, 'EMPLOYEE_NO_TAKEN', { employee_no: MESSAGES.employeeNoTaken });
  }
}

async function loadAccount(manager, id) {
  if (!isUuid(id)) throw Errors.notFound(MESSAGES.notFound, 'ACCOUNT_NOT_FOUND');
  const account = await manager.getRepository(Account).findOneBy({ accountId: id });
  if (!account) throw Errors.notFound(MESSAGES.notFound, 'ACCOUNT_NOT_FOUND');
  return account;
}

/** Locks every active Super Admin so two concurrent changes cannot both remove "the last one". */
async function lockActiveSuperAdmins(manager) {
  await manager.query(`SELECT account_id FROM accounts WHERE role_key = 'super_admin' AND is_active = true FOR UPDATE`);
}

async function assertNotLastSuperAdmin(manager, target) {
  if (target.roleKey !== ROLES.SUPER_ADMIN || !target.isActive) return;
  const [{ others }] = await manager.query(
    `SELECT count(*)::int AS others FROM accounts WHERE role_key = 'super_admin' AND is_active = true AND account_id <> $1`,
    [target.accountId],
  );
  if (others === 0) throw Errors.conflict(MESSAGES.lastSuperAdmin, 'LAST_SUPER_ADMIN');
}

function audit(manager, actor, action, before, after, ipAddress) {
  const account = after ?? before;
  return recordAudit(manager, {
    actor,
    action,
    entityType: 'account',
    entityId: account.account_id,
    officeId: account.office_id,
    before,
    after,
    ipAddress,
  });
}

export async function createAccount(dataSource, actor, body, { ipAddress, correlationId } = {}) {
  const input = parseAccountInput(body, { withPassword: true });
  // Office Head / Office Staff: the office must exist and be active (Catalogue). Super Admin and
  // Executive have no office, so they still save when Catalogue is down.
  if (isOfficeBound(input.roleKey)) await verifyOffice(input.officeId, { correlationId });
  const passwordHash = await hashPassword(input.password);

  try {
    const dto = await dataSource.transaction(async (manager) => {
      await assertUnique(manager, input);
      const saved = await manager.getRepository(Account).save({
        accountId: randomUUID(),
        employeeNo: input.employeeNo,
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        roleKey: input.roleKey,
        officeId: input.officeId,
        isActive: true,
      });
      const created = toAccountDto(await loadAccount(manager, saved.accountId));
      await audit(manager, actor, 'ACCOUNT_CREATED', null, created, ipAddress);
      return created;
    });
    kickOutbox();
    return dto;
  } catch (err) {
    throw conflictFor(err) ?? err;
  }
}

export async function updateAccount(dataSource, actor, id, body, { ipAddress, correlationId } = {}) {
  const input = parseAccountInput(body, { withPassword: false });
  const current = await loadAccount(dataSource, id);
  // Only ask Catalogue when the office actually changes (a name edit must not depend on it).
  if (isOfficeBound(input.roleKey) && input.officeId !== current.officeId) {
    await verifyOffice(input.officeId, { correlationId });
  }

  try {
    const dto = await dataSource.transaction(async (manager) => {
      await lockActiveSuperAdmins(manager);
      const existing = await loadAccount(manager, id);
      if (existing.roleKey === ROLES.SUPER_ADMIN && input.roleKey !== ROLES.SUPER_ADMIN) {
        await assertNotLastSuperAdmin(manager, existing);
      }
      await assertUnique(manager, input, id);
      const before = toAccountDto(existing);
      await manager.getRepository(Account).update(
        { accountId: id },
        { employeeNo: input.employeeNo, fullName: input.fullName, email: input.email, roleKey: input.roleKey, officeId: input.officeId },
      );
      const after = toAccountDto(await loadAccount(manager, id));
      await audit(manager, actor, 'ACCOUNT_UPDATED', before, after, ipAddress);
      return after;
    });
    kickOutbox();
    return dto;
  } catch (err) {
    throw conflictFor(err) ?? err;
  }
}

/** Deactivate or reactivate. Deactivation revokes refresh tokens. A repeat request is a no-op. */
export async function setAccountActive(dataSource, actor, id, isActive, { ipAddress } = {}) {
  const dto = await dataSource.transaction(async (manager) => {
    await lockActiveSuperAdmins(manager);
    const existing = await loadAccount(manager, id);
    const before = toAccountDto(existing);
    if (existing.isActive === isActive) return before;
    if (!isActive) await assertNotLastSuperAdmin(manager, existing);
    await manager.getRepository(Account).update({ accountId: id }, { isActive });
    if (!isActive) {
      await manager.query('UPDATE refresh_tokens SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [id]);
    }
    const after = toAccountDto(await loadAccount(manager, id));
    await audit(manager, actor, isActive ? 'ACCOUNT_REACTIVATED' : 'ACCOUNT_DEACTIVATED', before, after, ipAddress);
    return after;
  });
  kickOutbox();
  return dto;
}

export async function getAccount(dataSource, id) {
  return toAccountDto(await loadAccount(dataSource, id));
}

const escapeLike = (value) => value.replace(/[%_\\]/g, '\\$&');

/** Search by name (also email and employee number) and filter by role, office and status. */
export async function listAccounts(dataSource, { q, role, officeId, status, page = 1, pageSize = 25 } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const pageNo = Math.max(Number(page) || 1, 1);
  const qb = dataSource.getRepository(Account).createQueryBuilder('a');
  if (q?.trim()) {
    qb.andWhere('(a.fullName ILIKE :q OR a.email ILIKE :q OR a.employeeNo ILIKE :q)', { q: `%${escapeLike(q.trim())}%` });
  }
  if (role) {
    if (!isValidRole(role)) throw Errors.validation('Unknown role filter', { role: 'Unknown role' });
    qb.andWhere('a.roleKey = :role', { role });
  }
  if (officeId) {
    if (!isUuid(officeId)) throw Errors.validation('Unknown office filter', { office_id: 'Unknown office' });
    qb.andWhere('a.officeId = :officeId', { officeId });
  }
  if (status === 'active') qb.andWhere('a.isActive = true');
  if (status === 'inactive') qb.andWhere('a.isActive = false');
  const [items, total] = await qb
    .orderBy('lower(a.fullName)', 'ASC')
    .addOrderBy('a.accountId', 'ASC')
    .skip((pageNo - 1) * size)
    .take(size)
    .getManyAndCount();
  return { items: items.map(toAccountDto), total, page: pageNo, page_size: size };
}

/** Super Admin asks for a reset: a time-limited, single-use link is emailed to the registered address. */
export async function requestPasswordReset(dataSource, actor, id, { ipAddress } = {}) {
  const token = newOpaqueToken();
  const expiresAt = new Date(Date.now() + config.resetLinkMinutes * 60_000);

  const account = await dataSource.transaction(async (manager) => {
    const existing = await loadAccount(manager, id);
    if (!existing.isActive) {
      throw Errors.conflict('Reactivate the account before resetting its password', 'ACCOUNT_INACTIVE');
    }
    // A new link replaces any earlier unused one.
    await manager.query('UPDATE password_reset_tokens SET used_at = now() WHERE account_id = $1 AND used_at IS NULL', [id]);
    await manager.getRepository(PasswordResetToken).save({ tokenHash: hashToken(token), accountId: id, expiresAt });
    const dto = toAccountDto(existing);
    await recordAudit(manager, {
      actor,
      action: 'PASSWORD_RESET_REQUESTED',
      entityName: dto.full_name,
      entityType: 'account',
      entityId: id,
      officeId: dto.office_id,
      after: { account_id: id, email: dto.email, expires_at: expiresAt.toISOString() }, // never the link or a password
      ipAddress,
    });
    return existing;
  });
  kickOutbox();

  await sendPasswordResetEmail({
    to: account.email,
    name: account.fullName,
    link: `${config.publicBaseUrl}/reset-password?token=${encodeURIComponent(token)}`,
    expiresInMinutes: config.resetLinkMinutes,
  });
  return { email: account.email, expires_at: expiresAt.toISOString() };
}

/** Uses the emailed link: sets the new password; the old one stops working and sessions are revoked. */
export async function completePasswordReset(dataSource, { token, newPassword }, { ipAddress } = {}) {
  const problem = passwordProblem(newPassword);
  if (problem) throw Errors.validation(problem, { new_password: problem });
  const invalid = () => Errors.badRequest('This reset link is invalid or has expired', null, 'RESET_LINK_INVALID');
  if (typeof token !== 'string' || !token) throw invalid();

  const passwordHash = await hashPassword(newPassword);
  await dataSource.transaction(async (manager) => {
    // Single atomic claim: two people cannot use the same link.
    const claimed = await manager
      .createQueryBuilder()
      .update(PasswordResetToken)
      .set({ usedAt: () => 'now()' })
      .where('token_hash = :hash AND used_at IS NULL AND expires_at > now()', { hash: hashToken(token) })
      .returning('account_id')
      .execute();
    if (!claimed.raw.length) throw invalid();
    const accountId = claimed.raw[0].account_id;
    const account = await loadAccount(manager, accountId);
    if (!account.isActive) throw invalid();
    await manager.getRepository(Account).update({ accountId }, { passwordHash });
    await manager.query('UPDATE refresh_tokens SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [accountId]);
    await recordAudit(manager, {
      actor: { id: accountId, role: account.roleKey },
      action: 'PASSWORD_RESET',
      entityName: account.fullName,
      entityType: 'account',
      entityId: accountId,
      officeId: account.officeId,
      after: { account_id: accountId }, // no password values
      ipAddress,
    });
  });
  kickOutbox();
}
