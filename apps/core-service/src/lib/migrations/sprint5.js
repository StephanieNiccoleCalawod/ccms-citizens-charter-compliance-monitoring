// Sprint 5 Core schema changes: explicit, one advisory lock, every statement safe to run twice (same style as the Identity and
// Operations sprint5 migrations). Run as schema owner, before deploying the code that needs it.
//
// CC048: per-office working days and hours, with an optional lunch break.
//   office_schedules          one row per office per weekday (always seven rows together, written by the service in one
//                             transaction). An office with NO rows uses the campus schedule (working_hours, CC014); the
//                             absence of rows is what "uses the campus schedule" means, so nothing is copied from the campus.
//   office_schedule_versions  the office's schedule version counter. It lives apart from the rows because resetting an office to
//                             the campus schedule deletes its rows, and a counter that restarted at 1 would let a stale editor's
//                             version match again (a lost update). The rows carry the same version value as a convenience.
// Times are 24-hour 'HH:MM' text, the same representation as working_hours; weekday is 0 (Sunday) to 6 (Saturday), as there.
const TIME = "~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'";

async function addConstraint(manager, table, name, definition) {
  const rows = await manager.query('SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass', [name, table]);
  if (!rows.length) await manager.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
}

export async function migrateSprint5Core(dataSource) {
  await dataSource.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(43436, 503)');
    await officeSchedules(manager); // CC048
  });
}

async function officeSchedules(manager) {
  await manager.query(`CREATE TABLE IF NOT EXISTS office_schedules (
    office_id uuid NOT NULL,
    weekday smallint NOT NULL,
    is_working boolean NOT NULL DEFAULT false,
    opens_at text,
    closes_at text,
    closes_for_lunch boolean NOT NULL DEFAULT false,
    lunch_start text,
    lunch_end text,
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (office_id, weekday))`);
  await manager.query(`CREATE TABLE IF NOT EXISTS office_schedule_versions (
    office_id uuid PRIMARY KEY,
    version integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now())`);

  // The primary key (office_id, weekday) is the one-row-per-office-per-weekday rule and also the index for "all rows of an office".
  await addConstraint(manager, 'office_schedules', 'office_schedules_office_fk', 'FOREIGN KEY (office_id) REFERENCES offices (office_id)');
  await addConstraint(manager, 'office_schedule_versions', 'office_schedule_versions_office_fk', 'FOREIGN KEY (office_id) REFERENCES offices (office_id)');
  await addConstraint(manager, 'office_schedules', 'office_schedules_weekday_ck', 'CHECK (weekday BETWEEN 0 AND 6)');
  await addConstraint(manager, 'office_schedules', 'office_schedules_version_ck', 'CHECK (version >= 1)');
  await addConstraint(manager, 'office_schedule_versions', 'office_schedule_versions_version_ck', 'CHECK (version >= 0)');
  // A working day has an opening and a later closing time; a non-working day has neither.
  await addConstraint(
    manager,
    'office_schedules',
    'office_schedules_times_ck',
    `CHECK (
      (is_working = false AND opens_at IS NULL AND closes_at IS NULL)
      OR (is_working = true AND opens_at ${TIME} AND closes_at ${TIME} AND closes_at > opens_at)
    )`,
  );
  // Lunch: only on a working day, inside the opening hours, ending after it starts. When it is off, no lunch times are kept.
  await addConstraint(
    manager,
    'office_schedules',
    'office_schedules_lunch_ck',
    `CHECK (
      (closes_for_lunch = false AND lunch_start IS NULL AND lunch_end IS NULL)
      OR (closes_for_lunch = true AND is_working = true AND lunch_start ${TIME} AND lunch_end ${TIME}
          AND lunch_start >= opens_at AND lunch_end <= closes_at AND lunch_end > lunch_start)
    )`,
  );
}
