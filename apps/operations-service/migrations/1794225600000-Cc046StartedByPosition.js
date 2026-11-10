import { assertColumnsEmptyBeforeDrop, assertMigrationObjects } from 'ccms-shared';

const expected = { 'column:transactions.started_by_position': 'character varying(100)' };

// CC046: the starter's position, copied at Start so editing the account later never changes an old transaction.
// Empty on old rows. Same statement as the interim script src/lib/migrations/sprint5.js (IF NOT EXISTS).
export class Cc046StartedByPosition1794225600000 {
  name = 'Cc046StartedByPosition1794225600000';

  async up(queryRunner) {
    await assertMigrationObjects(queryRunner, expected);
    await queryRunner.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS started_by_position varchar(100)');
  }

  // Dropping the column deletes every copied position. Refused while any transaction has one, unless
  // CCMS_ALLOW_DATA_LOSS names this migration (after a backup).
  async down(queryRunner) {
    await assertColumnsEmptyBeforeDrop(queryRunner, this.name, 'transactions', ['started_by_position']);
    await queryRunner.query('ALTER TABLE transactions DROP COLUMN IF EXISTS started_by_position');
  }
}
