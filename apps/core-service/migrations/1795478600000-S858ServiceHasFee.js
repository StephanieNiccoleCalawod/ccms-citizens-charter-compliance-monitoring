import { assertTablesEmptyBeforeDrop } from 'ccms-shared';

// S8-58 (D-AC-7): whether a service charges a fee. Existing services keep today's behaviour (proof of payment allowed), so the
// column starts true; an office turns it off for a free service.
export class S858ServiceHasFee1795478600000 {
  name = 'S858ServiceHasFee1795478600000';
  async up(runner) {
    await runner.query('ALTER TABLE services ADD COLUMN has_fee boolean NOT NULL DEFAULT true');
  }
  async down(runner) {
    await assertTablesEmptyBeforeDrop(runner, this.name, ['services']);
    await runner.query('ALTER TABLE services DROP COLUMN has_fee');
  }
}
