import { assertColumnsEmptyBeforeDrop, assertMigrationObjects } from 'ccms-shared';
export class Cc046StarterName1794300100000 {
  name = 'Cc046StarterName1794300100000';
  async up(runner) {
    await assertMigrationObjects(runner, { 'column:transactions.started_by_name': 'character varying(200)' });
    await runner.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS started_by_name varchar(200)');
  }
  async down(runner) {
    await assertColumnsEmptyBeforeDrop(runner, this.name, 'transactions', ['started_by_name']);
    await runner.query('ALTER TABLE transactions DROP COLUMN IF EXISTS started_by_name');
  }
}
