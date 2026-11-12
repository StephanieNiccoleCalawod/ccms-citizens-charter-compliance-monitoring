import { readFileSync } from 'node:fs';
import { OversightBaseline1793491200000 } from './1793491200000-OversightBaseline.js';
import { Tt2AnalyticsTransactions1794355300000 } from './1794355300000-Tt2AnalyticsTransactions.js';
import { Tt1AnalyticsTombstones1794528400000 } from './1794528400000-Tt1AnalyticsTombstones.js';
import { Cc032Complaints1794600000000 } from './1794600000000-Cc032Complaints.js';
import { Cc029Reports1794700000000 } from './1794700000000-Cc029Reports.js';
import { Cc034ComplaintHandling1794800000000 } from './1794800000000-Cc034ComplaintHandling.js';

// Ordered migrations. Naming: <13-digit epoch ms>-<Name>.js exporting class <Name><timestamp>. Append only: never edit
// or reorder a migration that may have run on the hosted database; add a new one instead.
// A later migration that creates a table must also GRANT the exact runtime access it needs (default privileges are
// revoked for the runtime roles).
export const migrations = [OversightBaseline1793491200000, Tt2AnalyticsTransactions1794355300000, Tt1AnalyticsTombstones1794528400000, Cc032Complaints1794600000000, Cc029Reports1794700000000, Cc034ComplaintHandling1794800000000];

export const baseline = {
  name: 'OversightBaseline1793491200000',
  schema: JSON.parse(readFileSync(new URL('./baseline-schema.json', import.meta.url), 'utf8')),
};
