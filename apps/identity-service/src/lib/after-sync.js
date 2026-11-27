import { migrateSprint5Identity } from './migrations/sprint5.js';
import { migrateSprint8Identity } from './migrations/sprint8.js';
// Runs after TypeORM has created the tables. Everything here is idempotent.
export async function afterSync(dataSource) {
  await migrateSprint5Identity(dataSource);
  await migrateSprint8Identity(dataSource);
  // One account per email, regardless of letter case (TypeORM cannot declare an expression index).
  await dataSource.query('CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_lower_uq ON accounts (lower(email))');
  // CC056 (keep identical to migrations/sql/1794650000000-Cc056PermissionSwitches.up.sql): only the four switches exist, all off at first.
  const [{ n }] = await dataSource.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'permission_switches_key_ck'");
  if (!n) {
    await dataSource.query("ALTER TABLE permission_switches ADD CONSTRAINT permission_switches_key_ck CHECK (switch_key IN ('STAFF_HOLD_RESUME', 'STAFF_BACKDATE', 'STAFF_VIEW_COMPLAINTS', 'STAFF_VIEW_REPORTS'))");
  }
  const [{ scopeCk }] = await dataSource.query("SELECT count(*)::int AS \"scopeCk\" FROM pg_constraint WHERE conname = 'permission_switches_scope_ck'");
  if (!scopeCk) {
    await dataSource.query("ALTER TABLE permission_switches ADD CONSTRAINT permission_switches_scope_ck CHECK (scope IN ('ALL', 'SPECIFIC'))");
  }
  const [{ officeFk }] = await dataSource.query("SELECT count(*)::int AS \"officeFk\" FROM pg_constraint WHERE conname = 'permission_switch_offices_switch_fk'");
  if (!officeFk) {
    await dataSource.query('ALTER TABLE permission_switch_offices ADD CONSTRAINT permission_switch_offices_switch_fk FOREIGN KEY (switch_key) REFERENCES permission_switches(switch_key)');
  }
  await dataSource.query("INSERT INTO permission_switches (switch_key, enabled) VALUES ('STAFF_HOLD_RESUME', false), ('STAFF_BACKDATE', false), ('STAFF_VIEW_COMPLAINTS', false), ('STAFF_VIEW_REPORTS', false) ON CONFLICT (switch_key) DO NOTHING");
}
