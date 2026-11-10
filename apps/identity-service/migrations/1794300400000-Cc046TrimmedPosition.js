import { readFileSync } from 'node:fs';
import { assertMigrationObjects } from 'ccms-shared';
const accepted = JSON.parse(readFileSync(new URL('./sprint5-schema.json', import.meta.url), 'utf8'));
const latest = JSON.parse(readFileSync(new URL('./integration-schema.json', import.meta.url), 'utf8'));
const key = 'constraint:accounts.accounts_position_ck';
export class Cc046TrimmedPosition1794300400000 {
  name = 'Cc046TrimmedPosition1794300400000';
  async up(runner) {
    const existing = await assertMigrationObjects(runner, accepted);
    if (!existing['column:accounts.position']) throw new Error('Position column migration must run first');
    if (existing[key] === latest[key]) return;
    const [{ count }] = await runner.query(`SELECT count(*)::int AS count FROM accounts WHERE position IS NOT NULL
      AND (position IS DISTINCT FROM NULLIF(btrim(position), '') OR char_length(position) NOT BETWEEN 1 AND 100)`);
    if (count) throw new Error(`${count} account positions need reviewed normalization; no records were changed`);
    await runner.query('ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_position_ck');
    await runner.query('ALTER TABLE accounts ADD CONSTRAINT accounts_position_ck CHECK (position IS NULL OR (position = btrim(position) AND char_length(position) BETWEEN 1 AND 100))');
  }
  async down(runner) {
    await assertMigrationObjects(runner, accepted);
    await runner.query('ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_position_ck');
    await runner.query('ALTER TABLE accounts ADD CONSTRAINT accounts_position_ck CHECK (position IS NULL OR char_length(btrim(position)) BETWEEN 1 AND 100)');
  }
}
