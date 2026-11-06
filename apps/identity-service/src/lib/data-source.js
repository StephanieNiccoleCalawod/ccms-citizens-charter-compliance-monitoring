import { getDataSource } from 'ccms-shared';
import { afterSync } from './after-sync.js';
import { entities } from './entities/index.js';

// Runtime never changes schema. Explicit db:sync/bootstrap commands override this option.
export const dbOptions = { entities, afterSync, synchronize: false };

/** The service's initialised TypeORM DataSource (created on first use, shared per process). */
export function getDb() {
  return getDataSource(dbOptions);
}
