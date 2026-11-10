import { readFileSync } from 'node:fs';
import { assertNewTablesCompatible, assertTablesEmptyBeforeDrop } from 'ccms-shared';

const expected = JSON.parse(readFileSync(new URL('./integration-schema.json', import.meta.url), 'utf8'));
export class Cc048OfficeSchedules1794300000000 {
  name = 'Cc048OfficeSchedules1794300000000';
  async up(runner) {
    if (await assertNewTablesCompatible(runner, expected)) return;
    await runner.query(readFileSync(new URL('./sql/1794300000000-Cc048OfficeSchedules.up.sql', import.meta.url), 'utf8'));
  }
  async down(runner) {
    await assertTablesEmptyBeforeDrop(runner, this.name, ['office_schedules', 'office_schedule_versions']);
    await runner.query('DROP TABLE IF EXISTS office_schedules');
    await runner.query('DROP TABLE IF EXISTS office_schedule_versions');
  }
}
