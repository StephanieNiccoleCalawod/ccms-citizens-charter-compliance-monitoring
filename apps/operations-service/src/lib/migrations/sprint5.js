// Sprint 5-7 Operations schema changes, in the same explicit style as sprint4-critical.js:
// one function, one advisory lock, every statement safe to run twice. Each backlog item adds its own step below.
// Old rows keep NULL in every new column (no guessing: "Not recorded").
export async function migrateSprint5Operations(dataSource) {
  await dataSource.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(43436, 501)');
    await outcomeColumns(manager); // CC050
    await positionColumn(manager); // CC046
  });
}

// CC050: how a completed transaction ended. NULL on old rows and on Completed rows before the outcome was asked.
async function outcomeColumns(manager) {
  await manager.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS outcome varchar(12)');
  await manager.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS disapproval_reason text');
  await manager.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS disapproval_notice_given boolean');
  await manager.query('ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_outcome_ck');
  await manager.query(`ALTER TABLE transactions ADD CONSTRAINT transactions_outcome_ck CHECK (
    (outcome IS NULL AND disapproval_reason IS NULL AND disapproval_notice_given IS NULL) OR
    (outcome = 'GRANTED' AND disapproval_reason IS NULL AND disapproval_notice_given IS NULL) OR
    (outcome = 'DISAPPROVED' AND disapproval_reason IS NOT NULL AND char_length(btrim(disapproval_reason)) BETWEEN 1 AND 1000
       AND disapproval_notice_given IS TRUE))`);
}

// CC046: the starter's position, copied at Start so editing the account later never changes an old transaction.
// Empty on old rows and whenever Identity could not be reached at Start.
async function positionColumn(manager) {
  await manager.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS started_by_position varchar(100)');
}
