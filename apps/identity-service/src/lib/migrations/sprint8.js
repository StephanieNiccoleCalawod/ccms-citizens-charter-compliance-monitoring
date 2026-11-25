// S8-52 Request Access: the CHECK constraints of access_requests and account_permission_grants. TypeORM creates the tables from the
// entities and cannot declare checks, so they are added here (idempotent). Keep identical to migrations/sql/1795400000000-AccessRequests.up.sql.
const KEYS = "('REPORTS_PER_PERSON', 'RECORD_PAST_TRANSACTIONS', 'EXPORT_CSV', 'VIEW_OFFICE_QUEUE')";
const CHECKS = [
  ['access_requests', 'access_requests_status_ck', "CHECK (status IN ('PENDING', 'GRANTED', 'DENIED', 'REVOKED', 'EXPIRED'))"],
  ['access_requests', 'access_requests_key_ck', `CHECK (permission_key IN ${KEYS})`],
  ['access_requests', 'access_requests_grant_end_ck', "CHECK (status <> 'GRANTED' OR ends_on IS NOT NULL)"],
  ['account_permission_grants', 'account_permission_grants_status_ck', "CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED'))"],
  ['account_permission_grants', 'account_permission_grants_key_ck', `CHECK (permission_key IN ${KEYS})`],
];

export async function migrateSprint8Identity(dataSource) {
  await dataSource.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(43436, 801)');
    for (const [table, name, definition] of CHECKS) {
      const [{ n }] = await manager.query('SELECT count(*)::int AS n FROM pg_constraint WHERE conname = $1', [name]);
      if (!n) await manager.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
    }
  });
}
