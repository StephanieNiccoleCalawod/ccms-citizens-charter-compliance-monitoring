import { readFileSync } from 'node:fs';
import { OperationsBaseline1793491200000 } from './1793491200000-OperationsBaseline.js';
import { Cc050TransactionOutcome1794182400000 } from './1794182400000-Cc050TransactionOutcome.js';
import { Cc046StartedByPosition1794225600000 } from './1794225600000-Cc046StartedByPosition.js';
import { Cc046StarterName1794300100000 } from './1794300100000-Cc046StarterName.js';
import { Cc051OutsideHours1794300200000 } from './1794300200000-Cc051OutsideHours.js';
import { Cc038ForecastRuns1794300300000 } from './1794300300000-Cc038ForecastRuns.js';
import { Tt2AnalyticsOutbox1794355200000 } from './1794355200000-Tt2AnalyticsOutbox.js';

// Ordered migrations. Naming: <13-digit epoch ms>-<Name>.js exporting class <Name><timestamp>. Append only: never edit
// or reorder a migration that may have run on the hosted database; add a new one instead.
export const migrations = [OperationsBaseline1793491200000, Cc050TransactionOutcome1794182400000, Cc046StartedByPosition1794225600000,
  Cc046StarterName1794300100000, Cc051OutsideHours1794300200000, Cc038ForecastRuns1794300300000, Tt2AnalyticsOutbox1794355200000];

export const baseline = {
  allowedExtras: { ...JSON.parse(readFileSync(new URL('./integration-schema.json', import.meta.url), 'utf8')),
    ...JSON.parse(readFileSync(new URL('./sprint5-schema.json', import.meta.url), 'utf8')) },
  name: 'OperationsBaseline1793491200000',
  schema: JSON.parse(readFileSync(new URL('./baseline-schema.json', import.meta.url), 'utf8')),
};
