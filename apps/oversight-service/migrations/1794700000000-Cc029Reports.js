import { readFileSync } from 'node:fs';
import { assertNewTablesCompatible, assertTablesEmptyBeforeDrop } from 'ccms-shared';

// Sprint 7 CC029/CC030/CC031: the reports table, with the exact runtime grants. The expected catalog definitions are frozen in
// cc029-reports-schema.json (taken from a database built by the .up.sql file). Run as the schema owner (DATABASE_ADMIN_URL),
// never as ccms_logs_writer. The runtime roles exist since the baseline.
const expected = JSON.parse(readFileSync(new URL('./cc029-reports-schema.json', import.meta.url), 'utf8'));

export class Cc029Reports1794700000000 {
  name = 'Cc029Reports1794700000000';

  async up(runner) {
    if (await assertNewTablesCompatible(runner, expected)) return;
    await runner.query(readFileSync(new URL('./sql/1794700000000-Cc029Reports.up.sql', import.meta.url), 'utf8'));
  }

  async down(runner) {
    // Published reports are the official record: back up first and allow it explicitly (CCMS_ALLOW_DATA_LOSS=<this migration>).
    await assertTablesEmptyBeforeDrop(runner, this.name, ['reports']);
    await runner.query('DROP TABLE IF EXISTS reports');
  }
}
