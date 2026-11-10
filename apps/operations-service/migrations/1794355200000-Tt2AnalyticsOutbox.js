import { readFileSync } from 'node:fs';
import { assertMigrationObjects, assertNewTablesCompatible, assertTablesEmptyBeforeDrop } from 'ccms-shared';

// Sprint 5 TT2: transactions.analytics_event_version and the analytics_outbox table. The expected catalog definitions are
// frozen in tt2-analytics-schema.json (taken from a database built by the .up.sql file); an existing, different object is
// refused instead of being repaired silently.
const schema = JSON.parse(readFileSync(new URL('./tt2-analytics-schema.json', import.meta.url), 'utf8'));
const COLUMN = 'column:transactions.analytics_event_version';
const tableObjects = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== COLUMN));

export class Tt2AnalyticsOutbox1794355200000 {
  name = 'Tt2AnalyticsOutbox1794355200000';

  async up(runner) {
    await assertMigrationObjects(runner, { [COLUMN]: schema[COLUMN] });
    const tableExists = await assertNewTablesCompatible(runner, tableObjects);
    const columnExists = (await runner.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'analytics_event_version'",
    )).length > 0;
    if (tableExists && columnExists) return;
    if (tableExists !== columnExists) throw new Error('Partial TT2 analytics objects exist; review a fix-up migration before proceeding');
    await runner.query(readFileSync(new URL('./sql/1794355200000-Tt2AnalyticsOutbox.up.sql', import.meta.url), 'utf8'));
  }

  async down(runner) {
    // Undelivered or delivered events are deleted with the table, and analytics versions are lost with the column:
    // both need a backup and CCMS_ALLOW_DATA_LOSS=<this migration> when anything was recorded.
    await assertTablesEmptyBeforeDrop(runner, this.name, ['analytics_outbox']);
    const [{ exists }] = await runner.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'analytics_event_version') AS exists",
    );
    if (exists) {
      const [{ count }] = await runner.query('SELECT count(*)::int AS count FROM transactions WHERE analytics_event_version <> 0');
      const allowed = (process.env.CCMS_ALLOW_DATA_LOSS ?? '').split(',').map((v) => v.trim());
      if (count > 0 && !allowed.includes(this.name)) {
        throw new Error(
          `Reverting ${this.name} would delete analytics versions in ${count} row(s) of transactions (analytics_event_version). ` +
            `Take a backup first, then re-run with CCMS_ALLOW_DATA_LOSS=${this.name} if the loss is intended.`,
        );
      }
    }
    await runner.query('DROP TABLE IF EXISTS analytics_outbox');
    await runner.query('ALTER TABLE transactions DROP COLUMN IF EXISTS analytics_event_version');
  }
}
