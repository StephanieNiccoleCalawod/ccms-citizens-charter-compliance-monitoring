// LOCAL DEVELOPMENT ONLY. Creates/updates this service's tables from its TypeORM entities (schema synchronization).
// Refused for a hosted database (DB_TARGET=hosted, or any non-local host) before connecting: hosted databases change
// only through the numbered migrations (npm run migrate:run).
import { assertSchemaSyncAllowed, getDataSource } from 'ccms-shared';
import { dbOptions } from '../src/lib/data-source.js';

try {
  assertSchemaSyncAllowed(process.env.DATABASE_URL, 'db:sync');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const dataSource = await getDataSource({ ...dbOptions, synchronize: true });
const tables = await dataSource.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
);
console.log(`Database ready. Tables: ${tables.map((t) => t.table_name).join(', ') || '(none)'}`);
await dataSource.destroy();
