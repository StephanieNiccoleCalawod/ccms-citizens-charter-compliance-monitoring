import { migrateSprint4Oversight } from './migrations/sprint4-critical.js';
import { PURGE_FUNCTION_SQL, PURGE_GRANTS_SQL } from '../../migrations/1794528400000-Tt1AnalyticsTombstones.js';
import { QUEUE_WAIT_CHECK, QUEUE_WAIT_CHECK_NAME } from '../../migrations/1794900000000-Cc040QueueWait.js';
// Runs after TypeORM has created the table. Everything here is idempotent.
// TypeORM cannot declare descending indexes, CHECK constraints, roles or grants, so the Logs data rules live
// here (the team has no migrations yet, E22 open).

export const LOGS_WRITER_ROLE = 'ccms_logs_writer';
export const OVERSIGHT_APP_ROLE = 'ccms_oversight_app';

async function addConstraint(dataSource, table, name, definition) {
  const rows = await dataSource.query('SELECT 1 FROM pg_constraint WHERE conname = $1', [name]);
  if (!rows.length) await dataSource.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
}

async function sqlFor(dataSource, template, values) {
  const [{ sql }] = await dataSource.query(`SELECT format($format$${template}$format$, ${values.map((_, i) => `$${i + 1}::text`).join(', ')}) AS sql`, values);
  return sql;
}

/** Creates and hardens a runtime role, and gives it a password only when provisioning received one. */
async function ensureRole(dataSource, role, password) {
  const [existing] = await dataSource.query(
    'SELECT rolsuper, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1',
    [role],
  );
  if (!existing) {
    try {
      await dataSource.query(`CREATE ROLE ${role} NOLOGIN`);
    } catch (err) {
      // Another run created it a moment ago (duplicate_object): that is fine.
      if (err?.code !== '42710') throw err;
    }
  }

  // Managed PostgreSQL owners (including Neon owners) may have CREATEROLE without permission to change
  // SUPERUSER, REPLICATION, or BYPASSRLS. Fail closed if a pre-existing runtime role has any of those
  // capabilities; an infrastructure administrator must remove them before provisioning can safely continue.
  if (existing?.rolsuper || existing?.rolreplication || existing?.rolbypassrls) {
    throw new Error(`${role} has a prohibited administrative role attribute`);
  }
  await dataSource.query(`ALTER ROLE ${role} NOCREATEDB NOCREATEROLE NOINHERIT`);

  // NOINHERIT does not prevent SET ROLE. Remove every membership as well, including memberships added by
  // an earlier or accidental provisioning run.
  const memberships = await dataSource.query(
    `SELECT parent.rolname
       FROM pg_auth_members membership
       JOIN pg_roles member ON member.oid = membership.member
       JOIN pg_roles parent ON parent.oid = membership.roleid
      WHERE member.rolname = $1`,
    [role],
  );
  for (const membership of memberships) {
    await dataSource.query(await sqlFor(dataSource, 'REVOKE %I FROM %I', [membership.rolname, role]));
  }

  if (password) {
    // ALTER ROLE cannot take bind parameters, so the statement is built by the server with %I and %L quoting.
    await dataSource.query(await sqlFor(dataSource, 'ALTER ROLE %I WITH LOGIN PASSWORD %L', [role, password]));
  }
}

export async function afterSync(dataSource) {
  await migrateSprint4Oversight(dataSource);
  await auditLogRules(dataSource);
  await analyticsRules(dataSource);
  await complaintRules(dataSource);
  await reportRules(dataSource);
  // Sprint 6 TT1 (keep identical to migrations/1794528400000-Tt1AnalyticsTombstones.js).
  await dataSource.query(PURGE_FUNCTION_SQL);

  // Keep all role mutations on one checked-out connection under an advisory lock so two syncs of this
  // database cannot concurrently update the same PostgreSQL system-catalog rows. The test suite runs its
  // temporary databases serially because PostgreSQL advisory locks do not span different databases while
  // roles do span the cluster.
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.query('SELECT pg_advisory_lock(43436, 2)');
    await auditLogGrants(runner);
    await analyticsGrants(runner);
    await complaintGrants(runner);
    await reportGrants(runner);
  } finally {
    await runner.query('SELECT pg_advisory_unlock(43436, 2)').catch(() => {});
    await runner.release();
  }
}

// TT2 (keep identical to migrations/sql/1794355300000-Tt2AnalyticsTransactions.up.sql).
async function analyticsRules(dataSource) {
  await addConstraint(
    dataSource,
    'analytics_transactions',
    'analytics_transactions_values_ck',
    "CHECK (event_version >= 0 AND held_minutes >= 0 AND status IN ('IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'AUTO_CLOSED') AND classification IN ('SIMPLE', 'COMPLEX', 'HIGHLY_TECHNICAL') AND client_type IN ('STUDENT', 'ALUMNI', 'EMPLOYEE', 'EXTERNAL') AND registry_status IN ('MATCHED', 'EXPIRED', 'NOT_FOUND', 'NONE') AND (outcome IS NULL OR outcome IN ('GRANTED', 'DISAPPROVED')))",
  );
  await dataSource.query('CREATE INDEX IF NOT EXISTS analytics_transactions_office_started_idx ON analytics_transactions (office_id, started_at DESC)');
  await dataSource.query('CREATE INDEX IF NOT EXISTS analytics_transactions_service_started_idx ON analytics_transactions (service_id, started_at DESC)');
  await dataSource.query('CREATE INDEX IF NOT EXISTS analytics_transactions_status_idx ON analytics_transactions (status)');
  // CC040 (keep identical to migrations/1794900000000-Cc040QueueWait.js).
  await addConstraint(dataSource, 'analytics_transactions', QUEUE_WAIT_CHECK_NAME, QUEUE_WAIT_CHECK);
}

// TT2 runtime access. Runs after auditLogGrants (which first revokes everything from the runtime roles). audit_log keeps
// exactly its own grants: nothing here touches it.
//   ccms_logs_writer    SELECT, INSERT, UPDATE on analytics_transactions and analytics_backfill_state (upsert, cursor)
//   ccms_oversight_app  SELECT on analytics_transactions
export async function analyticsGrants(dataSource) {
  await dataSource.query(`GRANT SELECT, INSERT, UPDATE ON analytics_transactions TO ${LOGS_WRITER_ROLE}`);
  await dataSource.query(`GRANT SELECT ON analytics_transactions TO ${OVERSIGHT_APP_ROLE}`);
  await dataSource.query(`GRANT SELECT, INSERT, UPDATE ON analytics_backfill_state TO ${LOGS_WRITER_ROLE}`);
  // Sprint 6 TT1: SELECT on the tombstones and EXECUTE on the seeded-only purge function. Never DELETE on the projection.
  for (const sql of PURGE_GRANTS_SQL) await dataSource.query(sql);
}

// CC032/CC033 (keep identical to migrations/sql/1794600000000-Cc032Complaints.up.sql).
async function complaintRules(dataSource) {
  await dataSource.query('CREATE INDEX IF NOT EXISTS complaints_office_created_idx ON complaints (office_id, created_at DESC)');
  // Sprint 7 CC034 (keep identical to migrations/sql/1794800000000-Cc034ComplaintHandling.up.sql).
  await addConstraint(
    dataSource,
    'complaints',
    'complaints_status_ck',
    "CHECK (status IN ('RECEIVED', 'ACKNOWLEDGED', 'RESOLVED') AND ((status = 'RECEIVED') = (acknowledged_at IS NULL)) AND ((status = 'RESOLVED') = (resolved_at IS NOT NULL)) AND (status <> 'RESOLVED' OR (reply IS NOT NULL AND char_length(btrim(reply)) >= 1)))",
  );
}

// Runtime access, after auditLogGrants (which first revokes everything from the runtime roles).
//   ccms_logs_writer    SELECT, INSERT, UPDATE on complaints (UPDATE for staff handling, Sprint 7; never DELETE); counters need SELECT, INSERT, UPDATE, DELETE
//   ccms_oversight_app  SELECT on complaints
export async function complaintGrants(dataSource) {
  await dataSource.query(`GRANT SELECT, INSERT, UPDATE ON complaints TO ${LOGS_WRITER_ROLE}`);
  await dataSource.query(`GRANT SELECT ON complaints TO ${OVERSIGHT_APP_ROLE}`);
  await dataSource.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_hits TO ${LOGS_WRITER_ROLE}`);
}

// CC029/CC030/CC031 (keep identical to migrations/sql/1794700000000-Cc029Reports.up.sql).
async function reportRules(dataSource) {
  await addConstraint(
    dataSource,
    'reports',
    'reports_values_ck',
    "CHECK (version >= 1 AND status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED') AND period_type IN ('weekly', 'monthly', 'half_year', 'annual', 'custom') AND period_from <= period_to AND ((status = 'DRAFT') = (published_at IS NULL)) AND (status = 'DRAFT' OR published_by IS NOT NULL))",
  );
  await dataSource.query("CREATE UNIQUE INDEX IF NOT EXISTS reports_one_draft_uq ON reports (office_id, period_type, period_from, period_to) WHERE status = 'DRAFT'");
  await dataSource.query("CREATE UNIQUE INDEX IF NOT EXISTS reports_one_published_uq ON reports (office_id, period_type, period_from, period_to) WHERE status = 'PUBLISHED'");
  await dataSource.query('CREATE UNIQUE INDEX IF NOT EXISTS reports_version_uq ON reports (office_id, period_type, period_from, period_to, version)');
  await dataSource.query('CREATE INDEX IF NOT EXISTS reports_office_period_idx ON reports (office_id, period_from DESC)');
}

// Runtime access to reports. Runs after auditLogGrants (which first revokes everything from the runtime roles).
//   ccms_logs_writer    SELECT, INSERT, UPDATE (generate, publish, supersede). Never DELETE.
//   ccms_oversight_app  SELECT
export async function reportGrants(dataSource) {
  await dataSource.query(`GRANT SELECT, INSERT, UPDATE ON reports TO ${LOGS_WRITER_ROLE}`);
  await dataSource.query(`GRANT SELECT ON reports TO ${OVERSIGHT_APP_ROLE}`);
}

async function auditLogRules(dataSource) {
  await dataSource.query('CREATE INDEX IF NOT EXISTS audit_log_occurred_idx ON audit_log (occurred_at DESC)');
  await dataSource.query('CREATE INDEX IF NOT EXISTS audit_log_office_occurred_idx ON audit_log (office_id, occurred_at DESC)');
  // A person is always named, except for events the system itself makes.
  await addConstraint(dataSource, 'audit_log', 'audit_log_actor_ck', "CHECK (actor_user_id IS NOT NULL OR actor_role = 'system')");
}

// Sprint 4 TT2 (D6, NFR-DAT-001): nobody can change or delete a past entry.
//   ccms_logs_writer    INSERT and SELECT on audit_log. The running service connects as this role.
//   ccms_oversight_app  SELECT only (the future reports and analytics).
// UPDATE, DELETE and TRUNCATE are refused for both and for everyone else (PUBLIC). The schema owner that runs
// `npm run db:sync` keeps the rights every table owner has; it is never the role the service runs as.
// Exported for the baseline migration (migrations/1793491200000-OversightBaseline.js), which provisions an empty database
// the same way. It accepts a DataSource or a QueryRunner (anything with query()).
export async function auditLogGrants(dataSource) {
  await ensureRole(dataSource, LOGS_WRITER_ROLE, process.env.LOGS_WRITER_PASSWORD);
  await ensureRole(dataSource, OVERSIGHT_APP_ROLE, process.env.OVERSIGHT_APP_PASSWORD);

  // PostgreSQL grants CONNECT and TEMPORARY on new databases to PUBLIC by default. Remove those defaults
  // so a credential from another CCMS database cannot enter this database even when both databases happen
  // to share a PostgreSQL cluster. The database owner retains its inherent migration rights.
  const database = (await dataSource.query('SELECT current_database() AS name'))[0].name;
  await dataSource.query(await sqlFor(dataSource, 'REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC', [database]));

  // PUBLIC and the runtime roles start with no schema or object privileges. This also removes accidental
  // historical grants, including REFERENCES and TRIGGER, not only UPDATE/DELETE/TRUNCATE.
  await dataSource.query('REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC');
  await dataSource.query('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC');
  await dataSource.query('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC');
  await dataSource.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${LOGS_WRITER_ROLE}, ${OVERSIGHT_APP_ROLE}`);
  await dataSource.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${LOGS_WRITER_ROLE}, ${OVERSIGHT_APP_ROLE}`);

  // Future tables and sequences created by this migration owner also start private. A later migration must
  // explicitly grant the exact runtime access it needs.
  await dataSource.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, ${LOGS_WRITER_ROLE}, ${OVERSIGHT_APP_ROLE}`);
  await dataSource.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, ${LOGS_WRITER_ROLE}, ${OVERSIGHT_APP_ROLE}`);

  await dataSource.query(`GRANT INSERT, SELECT ON audit_log TO ${LOGS_WRITER_ROLE}`);
  await dataSource.query(`GRANT SELECT ON audit_log TO ${OVERSIGHT_APP_ROLE}`);

  await dataSource.query(
    await sqlFor(dataSource, 'GRANT CONNECT ON DATABASE %I TO %I, %I', [database, LOGS_WRITER_ROLE, OVERSIGHT_APP_ROLE]),
  );
  await dataSource.query(`GRANT USAGE ON SCHEMA public TO ${LOGS_WRITER_ROLE}, ${OVERSIGHT_APP_ROLE}`);
}
