import { readFileSync } from 'node:fs';
import { assertNewTablesCompatible, assertTablesEmptyBeforeDrop } from 'ccms-shared';

// Sprint 6 CC032/CC033: complaints and rate_limit_hits (the public rate limiter's counters), with the exact runtime grants.
// Expected catalog definitions are frozen in cc032-complaints-schema.json (taken from a database built by the .up.sql file).
// Run as the schema owner (DATABASE_ADMIN_URL), never as ccms_logs_writer.
const expected = JSON.parse(readFileSync(new URL('./cc032-complaints-schema.json', import.meta.url), 'utf8'));

export class Cc032Complaints1794600000000 {
  name = 'Cc032Complaints1794600000000';

  async up(runner) {
    if (await assertNewTablesCompatible(runner, expected)) return;
    await runner.query(readFileSync(new URL('./sql/1794600000000-Cc032Complaints.up.sql', import.meta.url), 'utf8'));
  }

  async down(runner) {
    // Complaints are citizens' records: back up first and allow it explicitly (CCMS_ALLOW_DATA_LOSS=<this migration>).
    await assertTablesEmptyBeforeDrop(runner, this.name, ['complaints', 'rate_limit_hits']);
    await runner.query('DROP TABLE IF EXISTS rate_limit_hits');
    await runner.query('DROP TABLE IF EXISTS complaints');
  }
}
