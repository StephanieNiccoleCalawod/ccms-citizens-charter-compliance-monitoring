// Sprint 6 Operations schema changes: CC038 Request Volume Forecast.
// One function, one advisory lock (43436 / 601), every statement idempotent.
export async function migrateSprint6Operations(dataSource) {
  await dataSource.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(43436, 601)');
    await forecastRunsTable(manager);
  });
}

async function forecastRunsTable(manager) {
  await manager.query(`
    CREATE TABLE IF NOT EXISTS forecast_runs (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      office_id       uuid NOT NULL,
      service_id      uuid,
      selected_model  varchar(30)  NOT NULL,
      mae             numeric(10,4),
      history_start_date  date,
      history_end_date    date,
      history_working_days int,
      historical_transaction_count int,
      forecast_payload    jsonb NOT NULL DEFAULT '[]',
      weekly_total        int   NOT NULL DEFAULT 0,
      status              varchar(20) NOT NULL DEFAULT 'SUCCESS',
      error_code          varchar(50),
      error_message       text,
      generated_at        timestamptz NOT NULL DEFAULT now(),
      created_at          timestamptz NOT NULL DEFAULT now()
    )
  `);
  await manager.query('CREATE INDEX IF NOT EXISTS forecast_runs_office_idx ON forecast_runs (office_id, generated_at DESC)');
  await manager.query('CREATE INDEX IF NOT EXISTS forecast_runs_service_idx ON forecast_runs (service_id, generated_at DESC) WHERE service_id IS NOT NULL');
  await manager.query(`CREATE INDEX IF NOT EXISTS forecast_runs_status_idx ON forecast_runs (status)`);
  await manager.query(`ALTER TABLE forecast_runs DROP CONSTRAINT IF EXISTS forecast_runs_status_ck`);
  await manager.query(`ALTER TABLE forecast_runs ADD CONSTRAINT forecast_runs_status_ck CHECK (status IN ('SUCCESS','NOT_ENOUGH_HISTORY','TOO_FEW','ERROR'))`);
  await manager.query(`ALTER TABLE forecast_runs DROP CONSTRAINT IF EXISTS forecast_runs_model_ck`);
  await manager.query(`ALTER TABLE forecast_runs ADD CONSTRAINT forecast_runs_model_ck CHECK (selected_model IN ('HOLT_WINTERS_ADDITIVE','SEASONAL_NAIVE','NONE'))`);
}
