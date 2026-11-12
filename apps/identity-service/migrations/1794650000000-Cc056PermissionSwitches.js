import { readFileSync } from 'node:fs';
import { assertNewTablesCompatible, assertTablesEmptyBeforeDrop } from 'ccms-shared';

// Sprint 6 CC056: permission_switches (the four staff switches, all off) and account_last_login. Expected catalog definitions
// are frozen in cc056-switches-schema.json (taken from a database built by the .up.sql file).
const expected = JSON.parse(readFileSync(new URL('./cc056-switches-schema.json', import.meta.url), 'utf8'));
const SEED = "INSERT INTO permission_switches (switch_key, enabled) VALUES ('STAFF_HOLD_RESUME', false), ('STAFF_BACKDATE', false), ('STAFF_VIEW_COMPLAINTS', false), ('STAFF_VIEW_REPORTS', false) ON CONFLICT (switch_key) DO NOTHING";

export class Cc056PermissionSwitches1794650000000 {
  name = 'Cc056PermissionSwitches1794650000000';

  async up(runner) {
    if (await assertNewTablesCompatible(runner, expected)) {
      await runner.query(SEED); // tables already there and compatible: make sure the four rows exist, never change a value
      return;
    }
    await runner.query(readFileSync(new URL('./sql/1794650000000-Cc056PermissionSwitches.up.sql', import.meta.url), 'utf8'));
  }

  async down(runner) {
    // The switch history is in the audit log, but the current values and sign-in times would be lost: back up first.
    await assertTablesEmptyBeforeDrop(runner, this.name, ['account_last_login']);
    await runner.query('DROP TABLE IF EXISTS account_last_login');
    await runner.query('DROP TABLE IF EXISTS permission_switches');
  }
}
