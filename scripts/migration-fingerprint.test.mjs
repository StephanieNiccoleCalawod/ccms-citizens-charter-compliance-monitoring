import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareFingerprints, schemaFingerprint } from 'ccms-shared';

function catalog({ pg18 = false, nullable = false, validated = true } = {}) {
  return { query: async (sql) => {
    if (sql.includes('FROM pg_constraint con')) return pg18 ? [{ relname: 'accounts', conname: 'accounts_id_not_null',
      def: 'NOT NULL id', contype: 'n', convalidated: validated, columns_not_null: !nullable }] : [];
    if (sql.includes('FROM pg_attribute a JOIN pg_class')) return [{ relname: 'accounts', attname: 'id', type: 'uuid', attnotnull: !nullable, def: null }];
    if (sql.startsWith('SELECT c.relname FROM pg_class')) return [{ relname: 'accounts' }];
    return [];
  } };
}

test('PostgreSQL 16 and 18 validated NOT NULL definitions compare identically', async () => {
  assert.deepEqual(await schemaFingerprint(catalog({ pg18: true })), await schemaFingerprint(catalog()));
});
test('normalization still detects a dropped NOT NULL requirement', async () => {
  const diff = compareFingerprints(await schemaFingerprint(catalog()), await schemaFingerprint(catalog({ nullable: true })));
  assert.equal(diff.changed[0].key, 'column:accounts.id');
});
test('unvalidated PostgreSQL 18 NOT NULL constraints remain blocking differences', async () => {
  const schema = await schemaFingerprint(catalog({ pg18: true, validated: false }));
  assert.equal(schema['constraint:accounts.accounts_id_not_null'], 'NOT NULL id NOT VALID');
});
