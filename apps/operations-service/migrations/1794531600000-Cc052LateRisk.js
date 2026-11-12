import { assertTablesEmptyBeforeDrop } from 'ccms-shared';

export class Cc052LateRisk1794531600000 {
  name = 'Cc052LateRisk1794531600000';

  async up(runner) {
    await runner.query(`CREATE TABLE late_risk_runs (
      run_id uuid CONSTRAINT late_risk_runs_pkey PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      status varchar(24) NOT NULL,
      rows int NOT NULL,
      training_rows int NOT NULL,
      holdout_rows int NOT NULL,
      late_cases int NOT NULL,
      excluded_rows int NOT NULL,
      metrics jsonb,
      coefficients jsonb
    );
    CREATE INDEX late_risk_runs_created_idx ON late_risk_runs (created_at, run_id);
    CREATE TABLE late_risk_score_cache (
      office_id uuid CONSTRAINT late_risk_score_cache_pkey PRIMARY KEY,
      scored_at timestamptz NOT NULL,
      run_id uuid,
      payload jsonb NOT NULL
    );`);
  }

  async down(runner) {
    await assertTablesEmptyBeforeDrop(runner, this.name, ['late_risk_runs']);
    await runner.query('DROP TABLE late_risk_score_cache, late_risk_runs');
  }
}
