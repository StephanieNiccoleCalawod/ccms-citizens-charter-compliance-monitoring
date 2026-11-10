import { readFileSync } from 'node:fs';
import { assertColumnsEmptyBeforeDrop, assertMigrationObjects } from 'ccms-shared';

const expected = Object.fromEntries(Object.entries(JSON.parse(readFileSync(new URL('./sprint5-schema.json', import.meta.url), 'utf8')))
  .filter(([key]) => key !== 'column:transactions.started_by_position'));

// CC050: how a completed transaction ended (Granted or Disapproved). Old rows keep NULL in every new column.
// Same statements as the interim script src/lib/migrations/sprint5.js, so a database where that script already ran
// is left unchanged after existing definitions have been verified.
const COLUMNS = ['outcome', 'disapproval_reason', 'disapproval_notice_given'];

export class Cc050TransactionOutcome1794182400000 {
  name = 'Cc050TransactionOutcome1794182400000';

  async up(queryRunner) {
    const existing = await assertMigrationObjects(queryRunner, expected);
    await queryRunner.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS outcome varchar(12)');
    await queryRunner.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS disapproval_reason text');
    await queryRunner.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS disapproval_notice_given boolean');
    if (!('constraint:transactions.transactions_outcome_ck' in existing)) {
      await queryRunner.query(`ALTER TABLE transactions ADD CONSTRAINT transactions_outcome_ck CHECK (
    (outcome IS NULL AND disapproval_reason IS NULL AND disapproval_notice_given IS NULL) OR
    (outcome = 'GRANTED' AND disapproval_reason IS NULL AND disapproval_notice_given IS NULL) OR
    (outcome = 'DISAPPROVED' AND disapproval_reason IS NOT NULL AND char_length(btrim(disapproval_reason)) BETWEEN 1 AND 1000
       AND disapproval_notice_given IS TRUE))`);
    }
  }

  // Dropping the columns deletes every recorded outcome and disapproval reason. Refused while any transaction has one,
  // unless CCMS_ALLOW_DATA_LOSS names this migration (after a backup).
  async down(queryRunner) {
    await assertColumnsEmptyBeforeDrop(queryRunner, this.name, 'transactions', COLUMNS);
    await queryRunner.query('ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_outcome_ck');
    for (const column of COLUMNS) await queryRunner.query(`ALTER TABLE transactions DROP COLUMN IF EXISTS ${column}`);
  }
}
