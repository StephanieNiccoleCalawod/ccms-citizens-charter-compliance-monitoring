import { readFileSync } from 'node:fs';
import { assertEmptyForBaseline, refuseBaselineRevert } from 'ccms-shared';

// Baseline: the Operations (Transactions) schema as it stood before Sprint 5 (commit 64ca621: entities, after-sync.js and
// the Sprint 4 critical migration), captured with pg_dump --schema-only from a database built by that code. It does NOT
// contain CC050 or CC046; those are the numbered migrations that follow.
//   Empty database     migrate:run executes this file and creates everything, plus the settings row below.
//   Existing database  migrate:baseline only records this migration as applied; it never runs up().
const SQL = readFileSync(new URL('./sql/1793491200000-OperationsBaseline.up.sql', import.meta.url), 'utf8');
export const BASELINE_TABLES = ['audit_outbox', 'counters', 'rate_limit_hits', 'tracking_sequences', 'transaction_settings', 'transactions'];

export class OperationsBaseline1793491200000 {
  name = 'OperationsBaseline1793491200000';

  async up(queryRunner) {
    await assertEmptyForBaseline(queryRunner, BASELINE_TABLES, this.name);
    await queryRunner.query(SQL);
    // The single settings row a fresh database always had after db:sync (hold off, counters off, auto-close off).
    await queryRunner.query(
      'INSERT INTO transaction_settings (id, hold_enabled, counters_enabled, version) VALUES (1, false, false, 1) ON CONFLICT (id) DO NOTHING',
    );
  }

  async down() {
    refuseBaselineRevert(this.name);
  }
}
