import { readFileSync } from 'node:fs';
import { assertNewTablesCompatible, assertTablesEmptyBeforeDrop } from 'ccms-shared';

// Sprint 5 TT2: analytics_transactions (the projection) and analytics_backfill_state, with the exact runtime grants.
// Expected catalog definitions are frozen in tt2-analytics-schema.json (taken from a database built by the .up.sql
// file). Run as the schema owner (DATABASE_ADMIN_URL), never as ccms_logs_writer. The runtime roles exist since the baseline.
const expected = JSON.parse(readFileSync(new URL('./tt2-analytics-schema.json', import.meta.url), 'utf8'));
const TABLES = ['analytics_transactions', 'analytics_backfill_state'];

export class Tt2AnalyticsTransactions1794355300000 {
  name = 'Tt2AnalyticsTransactions1794355300000';

  async up(runner) {
    if (await assertNewTablesCompatible(runner, expected)) return;
    await runner.query(readFileSync(new URL('./sql/1794355300000-Tt2AnalyticsTransactions.up.sql', import.meta.url), 'utf8'));
  }

  async down(runner) {
    // The projection can be rebuilt by the backfill, but deleting rows still needs a backup and an explicit
    // CCMS_ALLOW_DATA_LOSS=<this migration> (TT1 rule).
    await assertTablesEmptyBeforeDrop(runner, this.name, TABLES);
    await runner.query('DROP TABLE IF EXISTS analytics_backfill_state');
    await runner.query('DROP TABLE IF EXISTS analytics_transactions');
  }
}
