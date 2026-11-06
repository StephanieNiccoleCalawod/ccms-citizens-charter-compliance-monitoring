import { randomUUID } from 'node:crypto';
import { ROLES, recordAudit } from 'ccms-shared';
import { toAccountDto } from './accounts.js';
import { Account } from './entities/index.js';
import { hashPassword, passwordProblem } from './passwords.js';

/**
 * One-time deployment aid (not a feature): creates the first Super Admin when none exists.
 * Running it again changes nothing. The account audits itself as the actor because nobody
 * else can exist yet.
 */
export async function bootstrapSuperAdmin(dataSource, { email, password, employeeNo = 'ADMIN-001', fullName = 'System Administrator' }) {
  const problem = passwordProblem(password);
  if (!email || problem) throw new Error(`Bootstrap needs BOOTSTRAP_ADMIN_EMAIL and a valid BOOTSTRAP_ADMIN_PASSWORD${problem ? ` (${problem})` : ''}`);

  const passwordHash = await hashPassword(password);
  return dataSource.transaction(async (manager) => {
    // Serialise concurrent runs so two deployments cannot both create one.
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['ccms-bootstrap-super-admin']);
    const existing = await manager.getRepository(Account).findOneBy({ roleKey: ROLES.SUPER_ADMIN });
    if (existing) return { created: false };

    const saved = await manager.getRepository(Account).save({
      accountId: randomUUID(),
      employeeNo,
      fullName,
      email: email.trim().toLowerCase(),
      passwordHash,
      roleKey: ROLES.SUPER_ADMIN,
      officeId: null,
      isActive: true,
    });
    const created = toAccountDto(await manager.getRepository(Account).findOneByOrFail({ accountId: saved.accountId }));
    await recordAudit(manager, {
      actor: { id: created.account_id, role: ROLES.SUPER_ADMIN },
      action: 'ACCOUNT_CREATED',
      entityType: 'account',
      entityId: created.account_id,
      after: created,
    });
    return { created: true, accountId: created.account_id };
  });
}
