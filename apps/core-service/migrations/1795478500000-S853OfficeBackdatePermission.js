import { assertTablesEmptyBeforeDrop } from 'ccms-shared';

export class S853OfficeBackdatePermission1795478500000 {
  name = 'S853OfficeBackdatePermission1795478500000';
  async up(runner) {
    await runner.query('ALTER TABLE offices ADD COLUMN allow_backdated_transactions boolean NOT NULL DEFAULT false');
  }
  async down(runner) {
    await assertTablesEmptyBeforeDrop(runner, this.name, ['offices']);
    await runner.query('ALTER TABLE offices DROP COLUMN allow_backdated_transactions');
  }
}
