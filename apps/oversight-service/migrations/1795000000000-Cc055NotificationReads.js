import { readFileSync } from 'node:fs';
import { assertNewTablesCompatible, assertTablesEmptyBeforeDrop } from 'ccms-shared';

// Sprint 7 CC055: the notification_reads table, with the exact runtime grants. Expected catalog definitions are frozen in
// cc055-notification-reads-schema.json (taken from a database built by the .up.sql file). Run as the schema owner
// (DATABASE_ADMIN_URL), never as ccms_logs_writer.
const expected = JSON.parse(readFileSync(new URL('./cc055-notification-reads-schema.json', import.meta.url), 'utf8'));

export class Cc055NotificationReads1795000000000 {
  name = 'Cc055NotificationReads1795000000000';

  async up(runner) {
    if (await assertNewTablesCompatible(runner, expected)) return;
    await runner.query(readFileSync(new URL('./sql/1795000000000-Cc055NotificationReads.up.sql', import.meta.url), 'utf8'));
  }

  // Read marks only say what a person has seen; refused while any exist unless CCMS_ALLOW_DATA_LOSS names this migration.
  async down(runner) {
    await assertTablesEmptyBeforeDrop(runner, this.name, ['notification_reads']);
    await runner.query('DROP TABLE IF EXISTS notification_reads');
  }
}
