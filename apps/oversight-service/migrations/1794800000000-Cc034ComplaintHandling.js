import { readFileSync } from 'node:fs';
import { assertColumnsEmptyBeforeDrop, assertMigrationObjects } from 'ccms-shared';

// Sprint 7 CC034/CC035: staff handling columns on complaints, a CHECK that keeps the status and its timestamps consistent, and UPDATE
// for the running service. Expected catalog definitions are frozen in cc034-complaint-handling-schema.json (taken from a database built
// by the two .up.sql files). Run as the schema owner (DATABASE_ADMIN_URL), never as ccms_logs_writer.
const expected = JSON.parse(readFileSync(new URL('./cc034-complaint-handling-schema.json', import.meta.url), 'utf8'));
const COLUMNS = ['due_at', 'acknowledged_at', 'acknowledged_by', 'resolved_at', 'resolved_by', 'reply'];

export class Cc034ComplaintHandling1794800000000 {
  name = 'Cc034ComplaintHandling1794800000000';

  async up(runner) {
    await assertMigrationObjects(runner, expected); // refuses a database where one of these objects exists with a different definition
    await runner.query(readFileSync(new URL('./sql/1794800000000-Cc034ComplaintHandling.up.sql', import.meta.url), 'utf8'));
  }

  // Dropping the columns deletes every acknowledgement and reply. Refused while any complaint has one, unless CCMS_ALLOW_DATA_LOSS names
  // this migration (after a backup).
  async down(runner) {
    await assertColumnsEmptyBeforeDrop(runner, this.name, 'complaints', ['acknowledged_at', 'resolved_at', 'reply']);
    await runner.query('ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_status_ck');
    for (const column of COLUMNS) await runner.query(`ALTER TABLE complaints DROP COLUMN IF EXISTS ${column}`);
    await runner.query('REVOKE UPDATE ON complaints FROM ccms_logs_writer');
  }
}
