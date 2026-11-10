// npm run migrate:show | migrate:run | migrate:revert | migrate:check-baseline | migrate:baseline
// TypeORM migrations (migrations/), never schema synchronization. See README "Database migrations".
import { createDataSource, runMigrationCli } from 'ccms-shared';
import { entities } from '../src/lib/entities/index.js';
import { baseline, migrations } from '../migrations/index.js';

try {
  process.exitCode = await runMigrationCli({
    service: 'operations',
    createSource: (url) => createDataSource({ url, entities, migrations, synchronize: false }),
    baseline,
  });
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
