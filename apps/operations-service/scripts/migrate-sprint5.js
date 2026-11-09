import { createDataSource } from 'ccms-shared';
import { dbOptions } from '../src/lib/data-source.js';
import { migrateSprint5Operations } from '../src/lib/migrations/sprint5.js';
const ds = createDataSource({ ...dbOptions, synchronize: false });
await ds.initialize();
try { await migrateSprint5Operations(ds); console.log('Sprint 5 Operations migration completed'); }
finally { await ds.destroy(); }
