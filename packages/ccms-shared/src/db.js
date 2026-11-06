import { DataSource, EntitySchema } from 'typeorm';

// Database access for every service is TypeORM on PostgreSQL. Entities are plain-JavaScript
// EntitySchema objects (no decorators). Schema changes are explicit: run the owning service
// db:sync or migrate command before startup. Runtime synchronization defaults to off.

// Audit outbox: an event row is written in the same transaction as the business change and later
// delivered to the Logs service. audit_id makes re-sends idempotent.
export const OutboxEvent = new EntitySchema({
  name: 'OutboxEvent',
  tableName: 'audit_outbox',
  columns: {
    auditId: { name: 'audit_id', type: 'uuid', primary: true },
    payload: { type: 'jsonb' },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
    sentAt: { name: 'sent_at', type: 'timestamptz', nullable: true },
    attempts: { type: 'int', default: 0 },
    lastError: { name: 'last_error', type: 'text', nullable: true },
    nextAttemptAt: { name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' },
  },
  indices: [{ name: 'audit_outbox_unsent_idx', columns: ['createdAt'], where: '"sent_at" IS NULL' }],
});

// Counter table for the public rate limit (see rate-limit.js). One row per key and window.
export const RateLimitHit = new EntitySchema({
  name: 'RateLimitHit',
  tableName: 'rate_limit_hits',
  columns: {
    key: { type: 'varchar', length: 200, primary: true },
    count: { type: 'int', default: 0 },
    resetAt: { name: 'reset_at', type: 'timestamptz' },
  },
});

export function envFlag(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(value.toLowerCase());
}

/**
 * Builds a DataSource.
 *   url          PostgreSQL connection string (defaults to DATABASE_URL)
 *   entities     the service's EntitySchema list (include OutboxEvent for services that audit)
 *   synchronize  create/update tables from the entities on start (default: DB_SYNCHRONIZE, false)
 *   afterSync    async (dataSource) => void, idempotent raw SQL that runs after sync
 *                (for example the append-only triggers on the Logs table). getDataSource only runs
 *                it when synchronize is on.
 */
export function createDataSource({ url = process.env.DATABASE_URL, entities, synchronize, logging = false } = {}) {
  if (!url) throw new Error('DATABASE_URL is not configured');
  // Neon (and any hosted Postgres) needs TLS. It is on when DATABASE_SSL is true or the URL asks
  // for it (sslmode=require); the certificate is verified unless DATABASE_SSL_INSECURE=true.
  const wantsSsl = envFlag('DATABASE_SSL', /[?&]sslmode=(require|verify-full|verify-ca)/.test(url));
  const shouldSynchronize = synchronize ?? envFlag('DB_SYNCHRONIZE', false);
  return new DataSource({
    type: 'postgres',
    url,
    entities,
    synchronize: shouldSynchronize,
    // TypeORM otherwise issues CREATE EXTENSION even when synchronize is false.
    installExtensions: shouldSynchronize,
    logging,
    ssl: wantsSsl ? { rejectUnauthorized: !envFlag('DATABASE_SSL_INSECURE', false) } : undefined,
    // Serverless: every warm instance keeps its own small pool. Point DATABASE_URL at Neon's pooled
    // (-pooler) host and keep this low so many instances do not exhaust the connection limit.
    extra: {
      max: Number(process.env.DB_POOL_MAX) > 0 ? Number(process.env.DB_POOL_MAX) : 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    },
  });
}

const STATE = '__ccmsDataSource';

/**
 * One initialised DataSource per process (it also survives Next.js dev hot reloads).
 * Options are used on the first call only.
 */
export function getDataSource(options = {}) {
  const g = globalThis;
  if (!g[STATE]) {
    g[STATE] = (async () => {
      const dataSource = createDataSource(options);
      await dataSource.initialize();
      // Only the connection that owns the schema (synchronize on) runs the post-sync SQL. A locked-down
      // runtime role (DB_SYNCHRONIZE=false) has no DDL rights and must not try.
      if (options.afterSync && dataSource.options.synchronize) await options.afterSync(dataSource);
      return dataSource;
    })().catch((err) => {
      g[STATE] = undefined; // allow a retry, for example when the database was not up yet
      throw err;
    });
  }
  return g[STATE];
}

/** Replaces the process DataSource (tests). */
export function setDataSource(dataSource) {
  globalThis[STATE] = dataSource ? Promise.resolve(dataSource) : undefined;
}

export function isUniqueViolation(err, constraintHint) {
  const code = err?.code ?? err?.driverError?.code;
  if (code !== '23505') return false;
  if (!constraintHint) return true;
  const constraint = err?.constraint ?? err?.driverError?.constraint ?? err?.message ?? '';
  return String(constraint).includes(constraintHint);
}
