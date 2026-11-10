import { readFileSync } from 'node:fs';
import { IdentityBaseline1793491200000 } from './1793491200000-IdentityBaseline.js';
import { Cc046AccountPosition1794225600000 } from './1794225600000-Cc046AccountPosition.js';
import { Cc046TrimmedPosition1794300400000 } from './1794300400000-Cc046TrimmedPosition.js';

// Ordered migrations. Naming: <13-digit epoch ms>-<Name>.js exporting class <Name><timestamp>. Append only: never edit
// or reorder a migration that may have run on the hosted database; add a new one instead.
export const migrations = [IdentityBaseline1793491200000, Cc046AccountPosition1794225600000, Cc046TrimmedPosition1794300400000];

export const baseline = {
  allowedExtras: JSON.parse(readFileSync(new URL('./sprint5-schema.json', import.meta.url), 'utf8')),
  name: 'IdentityBaseline1793491200000',
  // Schema fingerprint of the baseline (scripts/db-schema-fingerprint.mjs); migrate:baseline compares against it.
  schema: JSON.parse(readFileSync(new URL('./baseline-schema.json', import.meta.url), 'utf8')),
};
