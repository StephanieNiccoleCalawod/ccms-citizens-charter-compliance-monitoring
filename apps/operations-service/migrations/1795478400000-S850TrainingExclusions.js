import { assertTablesEmptyBeforeDrop } from 'ccms-shared';

// NULL on older runs means the exclusion count was not recorded, rather than claiming zero.
export const FORECAST_EXCLUSION_SQL = 'ALTER TABLE forecast_runs ADD COLUMN excluded_transaction_count integer CHECK (excluded_transaction_count >= 0)';
export class S850TrainingExclusions1795478400000 {
  name = 'S850TrainingExclusions1795478400000';
  async up(runner) { await runner.query(FORECAST_EXCLUSION_SQL); }
  async down(runner) {
    await assertTablesEmptyBeforeDrop(runner, this.name, ['forecast_runs']);
    await runner.query('ALTER TABLE forecast_runs DROP COLUMN excluded_transaction_count');
  }
}
