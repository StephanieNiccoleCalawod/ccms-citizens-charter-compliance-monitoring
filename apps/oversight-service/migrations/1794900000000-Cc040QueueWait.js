import { assertColumnsEmptyBeforeDrop, assertMigrationObjects } from 'ccms-shared';

// CC040: the measured queue wait in the analytics store (TT2 snapshot field queue_wait_minutes, optional and nullable).
// NULL = no ticket was linked at Start (and every row stored before CC040); 0 is a measured zero. Never a compliance input.
// The table-level grants of analytics_transactions (TT2) already cover a new column. Run as the schema owner.
// Keep identical to the AnalyticsTransaction entity and to queueWaitRules() in src/lib/after-sync.js.
export const QUEUE_WAIT_CHECK_NAME = 'analytics_transactions_queue_wait_ck';
export const QUEUE_WAIT_CHECK = 'CHECK (queue_wait_minutes IS NULL OR queue_wait_minutes >= 0)';

const EXPECTED = {
  'column:analytics_transactions.queue_wait_minutes': 'integer',
  [`constraint:analytics_transactions.${QUEUE_WAIT_CHECK_NAME}`]: 'CHECK (((queue_wait_minutes IS NULL) OR (queue_wait_minutes >= 0)))',
};

export class Cc040QueueWait1794900000000 {
  name = 'Cc040QueueWait1794900000000';

  async up(runner) {
    await assertMigrationObjects(runner, EXPECTED);
    await runner.query('ALTER TABLE analytics_transactions ADD COLUMN IF NOT EXISTS queue_wait_minutes integer');
    const [{ present }] = await runner.query('SELECT count(*)::int AS present FROM pg_constraint WHERE conname = $1', [QUEUE_WAIT_CHECK_NAME]);
    if (!present) await runner.query(`ALTER TABLE analytics_transactions ADD CONSTRAINT ${QUEUE_WAIT_CHECK_NAME} ${QUEUE_WAIT_CHECK}`);
  }

  // Dropping the column loses every measured wait; refused while any row has one unless CCMS_ALLOW_DATA_LOSS names this migration.
  // A backfill from Operations restores them after a re-apply.
  async down(runner) {
    await assertColumnsEmptyBeforeDrop(runner, this.name, 'analytics_transactions', ['queue_wait_minutes']);
    await runner.query(`ALTER TABLE analytics_transactions DROP CONSTRAINT IF EXISTS ${QUEUE_WAIT_CHECK_NAME}`);
    await runner.query('ALTER TABLE analytics_transactions DROP COLUMN IF EXISTS queue_wait_minutes');
  }
}
