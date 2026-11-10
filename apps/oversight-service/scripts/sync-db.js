// LOCAL DEVELOPMENT ONLY. Creates/updates this service's table, the two database roles and the grants (Sprint 4 TT2,
// CC005) by schema synchronization. It connects as the schema owner (DATABASE_ADMIN_URL). The running service connects
// as ccms_logs_writer (DATABASE_URL), which can only INSERT and SELECT on audit_log, so it never runs this.
// Refused for a hosted database (DB_TARGET=hosted, or any non-local host) before connecting: hosted databases change
// only through the numbered migrations (npm run migrate:run).
import { assertSchemaSyncAllowed, getDataSource } from 'ccms-shared';
import { dbOptions } from '../src/lib/data-source.js';

const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
try {
  assertSchemaSyncAllowed(url, 'db:sync');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const dataSource = await getDataSource({ ...dbOptions, url, synchronize: true });
const tables = await dataSource.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
);
console.log(`Database ready. Tables: ${tables.map((t) => t.table_name).join(', ') || '(none)'}`);
await dataSource.destroy();
