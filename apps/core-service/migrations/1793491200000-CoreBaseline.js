import { readFileSync } from 'node:fs';
import { assertEmptyForBaseline, refuseBaselineRevert } from 'ccms-shared';

// Baseline: the Core (Catalogue + Calendar) schema as it stood before Sprint 5 (commit 64ca621: entities, after-sync.js
// and the Sprint 4 critical migration), captured with pg_dump --schema-only from a database built by that code.
//   Empty database     migrate:run executes this file and creates everything, plus the default rows below.
//   Existing database  migrate:baseline only records this migration as applied; it never runs up().
const SQL = readFileSync(new URL('./sql/1793491200000-CoreBaseline.up.sql', import.meta.url), 'utf8');
export const BASELINE_TABLES = [
  'audit_outbox', 'calendar_exceptions', 'catalogue_settings', 'machine_keys', 'office_list_freeze', 'offices',
  'rate_limit_hits', 'required_documents', 'service_code_sequences', 'service_standards', 'services', 'sync_log',
  'term_dates', 'working_hours',
];

export class CoreBaseline1793491200000 {
  name = 'CoreBaseline1793491200000';

  async up(queryRunner) {
    await assertEmptyForBaseline(queryRunner, BASELINE_TABLES, this.name);
    await queryRunner.query(SQL);
    // The rows a fresh database always had after db:sync (after-sync.js and sprint4-critical.js): the single
    // institution settings row and the seven-day campus schedule (Mon-Fri 08:00-17:00).
    await queryRunner.query('INSERT INTO catalogue_settings (id) VALUES (1) ON CONFLICT DO NOTHING');
    await queryRunner.query(`
      INSERT INTO working_hours (day_of_week, is_working, opening_time, closing_time)
      SELECT d, d BETWEEN 1 AND 5, CASE WHEN d BETWEEN 1 AND 5 THEN '08:00' END, CASE WHEN d BETWEEN 1 AND 5 THEN '17:00' END
      FROM generate_series(0, 6) AS d
      ON CONFLICT (day_of_week) DO NOTHING`);
  }

  async down() {
    refuseBaselineRevert(this.name);
  }
}
