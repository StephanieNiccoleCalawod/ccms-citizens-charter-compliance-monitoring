import { readFileSync } from 'node:fs';
import { assertTablesEmptyBeforeDrop } from 'ccms-shared';

// Office-scoped staff permission switches: scope ('ALL' | 'SPECIFIC') on permission_switches and
// permission_switch_offices (switch_key, office_id).
export class OfficeScopedPermissionSwitches1795700000000 {
  name = 'OfficeScopedPermissionSwitches1795700000000';

  async up(runner) {
    await runner.query(readFileSync(new URL('./sql/1795700000000-OfficeScopedPermissionSwitches.up.sql', import.meta.url), 'utf8'));
    const [{ n }] = await runner.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'permission_switches_scope_ck'");
    if (!n) {
      await runner.query("ALTER TABLE permission_switches ADD CONSTRAINT permission_switches_scope_ck CHECK (scope IN ('ALL', 'SPECIFIC'))");
    }
  }

  async down(runner) {
    await assertTablesEmptyBeforeDrop(runner, this.name, ['permission_switch_offices']);
    const cols = await runner.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'permission_switches' AND column_name = 'scope'",
    );
    if (cols.length) {
      const [{ count }] = await runner.query("SELECT count(*)::int AS count FROM permission_switches WHERE scope <> 'ALL'");
      const allowed = (process.env.CCMS_ALLOW_DATA_LOSS ?? '').split(',').map((v) => v.trim());
      if (count > 0 && !allowed.includes(this.name)) {
        throw new Error(
          `Reverting ${this.name} would delete office-scope settings for ${count} permission switch(es). Take a backup first, then re-run with CCMS_ALLOW_DATA_LOSS=${this.name} if the loss is intended.`,
        );
      }
    }
    await runner.query('DROP TABLE IF EXISTS permission_switch_offices');
    await runner.query('ALTER TABLE permission_switches DROP CONSTRAINT IF EXISTS permission_switches_scope_ck');
    await runner.query('ALTER TABLE permission_switches DROP COLUMN IF EXISTS scope');
  }
}
