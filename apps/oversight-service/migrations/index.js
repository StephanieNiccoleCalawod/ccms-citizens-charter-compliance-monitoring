import { readFileSync } from 'node:fs';
import { OversightBaseline1793491200000 } from './1793491200000-OversightBaseline.js';
import { Tt2AnalyticsTransactions1794355300000 } from './1794355300000-Tt2AnalyticsTransactions.js';
import { Tt1AnalyticsTombstones1794528400000 } from './1794528400000-Tt1AnalyticsTombstones.js';

// Ordered migrations. Naming: <13-digit epoch ms>-<Name>.js exporting class <Name><timestamp>. Append only: never edit
// or reorder a migration that may have run on the hosted database; add a new one instead.
// A later migration that creates a table must also GRANT the exact runtime access it needs (default privileges are
// revoked for the runtime roles).
export const migrations = [OversightBaseline1793491200000, Tt2AnalyticsTransactions1794355300000, Tt1AnalyticsTombstones1794528400000];

export const baseline = {
  name: 'OversightBaseline1793491200000',
  schema: JSON.parse(readFileSync(new URL('./baseline-schema.json', import.meta.url), 'utf8')),
};
