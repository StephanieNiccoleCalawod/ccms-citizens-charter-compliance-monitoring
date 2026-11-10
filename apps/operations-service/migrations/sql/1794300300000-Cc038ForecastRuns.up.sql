-- Frozen from the reviewed explicit migration at e70fd8d; append new migrations for later changes.
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
    );

CREATE INDEX IF NOT EXISTS forecast_runs_office_idx ON forecast_runs (office_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS forecast_runs_service_idx ON forecast_runs (service_id, generated_at DESC) WHERE service_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS forecast_runs_status_idx ON forecast_runs (status);

ALTER TABLE forecast_runs DROP CONSTRAINT IF EXISTS forecast_runs_status_ck;

ALTER TABLE forecast_runs ADD CONSTRAINT forecast_runs_status_ck CHECK (status IN ('SUCCESS','NOT_ENOUGH_HISTORY','TOO_FEW','ERROR'));

ALTER TABLE forecast_runs DROP CONSTRAINT IF EXISTS forecast_runs_model_ck;

ALTER TABLE forecast_runs ADD CONSTRAINT forecast_runs_model_ck CHECK (selected_model IN ('HOLT_WINTERS_ADDITIVE','SEASONAL_NAIVE','NONE'));
