import { readFileSync } from 'node:fs';
import { assertColumnsEmptyBeforeDrop, assertMigrationObjects } from 'ccms-shared';

const expected = JSON.parse(readFileSync(new URL('./sprint5-schema.json', import.meta.url), 'utf8'));

// CC046: accounts.position, an optional label of up to 100 characters. Old accounts stay empty (NULL).
// Same statements as the interim script src/lib/migrations/sprint5.js, so a database where that script already ran
// is left unchanged after existing definitions have been verified.
export class Cc046AccountPosition1794225600000 {
  name = 'Cc046AccountPosition1794225600000';

  async up(queryRunner) {
    const existing = await assertMigrationObjects(queryRunner, expected);
    await queryRunner.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS position varchar(100)');
    if (!('constraint:accounts.accounts_position_ck' in existing)) {
      await queryRunner.query(
        'ALTER TABLE accounts ADD CONSTRAINT accounts_position_ck CHECK (position IS NULL OR char_length(btrim(position)) BETWEEN 1 AND 100)',
      );
    }
  }

  // Dropping the column deletes every recorded position. Refused while any account has one, unless
  // CCMS_ALLOW_DATA_LOSS names this migration (after a backup).
  async down(queryRunner) {
    await assertColumnsEmptyBeforeDrop(queryRunner, this.name, 'accounts', ['position']);
    await queryRunner.query('ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_position_ck');
    await queryRunner.query('ALTER TABLE accounts DROP COLUMN IF EXISTS position');
  }
}
