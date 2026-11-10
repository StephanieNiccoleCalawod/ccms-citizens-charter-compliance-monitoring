import { createDataSource } from 'ccms-shared';
import { dbOptions } from '../src/lib/data-source.js';
import { migrateSprint6Operations } from '../src/lib/migrations/sprint6.js';
const ds = createDataSource({ ...dbOptions, synchronize: false });
await ds.initialize();
try { await migrateSprint6Operations(ds); console.log('Sprint 6 Operations migration completed'); }
finally { await ds.destroy(); }
