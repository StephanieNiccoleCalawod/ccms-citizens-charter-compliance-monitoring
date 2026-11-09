// Sprint 5-7 Identity schema changes: explicit, one advisory lock, safe to run twice (same style as the Operations one).
export async function migrateSprint5Identity(dataSource) {
  await dataSource.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(43436, 502)');
    // CC046: position or designation, a label only. Optional, up to 100 characters; old accounts stay empty.
    await manager.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS position varchar(100)');
    await manager.query('ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_position_ck');
    await manager.query(`ALTER TABLE accounts ADD CONSTRAINT accounts_position_ck CHECK (position IS NULL OR char_length(btrim(position)) BETWEEN 1 AND 100)`);
  });
}
