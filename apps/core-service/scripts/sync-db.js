// LOCAL DEVELOPMENT ONLY. Creates/updates this service's tables from its TypeORM entities (schema synchronization).
// Refused for a hosted database (DB_TARGET=hosted, or any non-local host) before connecting, so neither the
// seeding-model preparation below nor the sync can touch it: hosted databases change only through the numbered
// migrations (npm run migrate:run).
import { assertSchemaSyncAllowed, createDataSource, getDataSource } from 'ccms-shared';
import { dbOptions } from '../src/lib/data-source.js';
import { migrateSeedingModel } from '../src/lib/catalogue/seeding-model-migration.js';

try {
  assertSchemaSyncAllowed(process.env.DATABASE_URL, 'db:sync');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Convert unambiguous old Catalogue fields before TypeORM compares the old and new schemas. Scope
// deliberately stops for manual classification because INTERNAL/EXTERNAL cannot be inferred.
const migrationSource = createDataSource({ ...dbOptions, synchronize: false });
await migrationSource.initialize();
try {
  await migrateSeedingModel(migrationSource);
} finally {
  await migrationSource.destroy();
}

// Always synchronise here after the data-preserving preparation: this connection owns the schema.
const dataSource = await getDataSource({ ...dbOptions, synchronize: true });
const tables = await dataSource.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
);
console.log(`Database ready. Tables: ${tables.map((t) => t.table_name).join(', ') || '(none)'}`);
await dataSource.destroy();
