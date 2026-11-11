import { readFileSync } from 'node:fs';
import { CoreBaseline1793491200000 } from './1793491200000-CoreBaseline.js';
import { Cc048OfficeSchedules1794300000000 } from './1794300000000-Cc048OfficeSchedules.js';
import { Cc058CalendarReasons1794441700000 } from './1794441700000-Cc058CalendarReasons.js';

// Ordered migrations. Naming: <13-digit epoch ms>-<Name>.js exporting class <Name><timestamp>. Append only: never edit
// or reorder a migration that may have run on the hosted database; add a new one instead.
export const migrations = [CoreBaseline1793491200000, Cc048OfficeSchedules1794300000000, Cc058CalendarReasons1794441700000];

export const baseline = {
  allowedExtras: JSON.parse(readFileSync(new URL('./integration-schema.json', import.meta.url), 'utf8')),
  name: 'CoreBaseline1793491200000',
  schema: JSON.parse(readFileSync(new URL('./baseline-schema.json', import.meta.url), 'utf8')),
};
