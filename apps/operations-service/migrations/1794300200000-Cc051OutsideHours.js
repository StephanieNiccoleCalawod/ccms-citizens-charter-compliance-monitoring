import { assertColumnsEmptyBeforeDrop, assertMigrationObjects } from 'ccms-shared';
export class Cc051OutsideHours1794300200000 {
  name = 'Cc051OutsideHours1794300200000';
  async up(runner) {
    await assertMigrationObjects(runner, { 'column:transactions.started_outside_hours': 'boolean NOT NULL DEFAULT false' });
    await runner.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS started_outside_hours boolean NOT NULL DEFAULT false');
  }
  async down(runner) {
    await assertColumnsEmptyBeforeDrop(runner, this.name, 'transactions', ['started_outside_hours']);
    await runner.query('ALTER TABLE transactions DROP COLUMN IF EXISTS started_outside_hours');
  }
}
