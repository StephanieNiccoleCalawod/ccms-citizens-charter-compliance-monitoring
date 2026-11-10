-- Sprint 5 TT2: the analytics projection (one latest snapshot per transaction) and the backfill progress row.
-- Additive only. FROZEN once it may have run on a hosted database; change the schema with a new numbered migration.
-- External IDs (transaction, office, service, staff accounts, counter) are plain values: no cross-database keys.

CREATE TABLE IF NOT EXISTS analytics_transactions (
    transaction_id uuid NOT NULL,
    tracking_no character varying(60) NOT NULL,
    office_id uuid NOT NULL,
    service_id uuid NOT NULL,
    service_code character varying(200) NOT NULL,
    classification character varying(20) NOT NULL,
    client_type character varying(20) NOT NULL,
    standard_days integer NOT NULL,
    standard_hours integer NOT NULL,
    standard_minutes integer NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    status character varying(20) NOT NULL,
    elapsed_working_minutes integer,
    is_compliant boolean,
    variance_minutes integer,
    held_minutes integer NOT NULL,
    is_backdated boolean NOT NULL,
    started_outside_hours boolean NOT NULL,
    registry_status character varying(12) NOT NULL,
    registry_miss_reason character varying(20),
    outcome character varying(12),
    started_by_user_id uuid NOT NULL,
    ended_by_user_id uuid,
    counter_id uuid,
    event_version integer NOT NULL,
    is_seeded boolean NOT NULL,
    received_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT analytics_transactions_pkey PRIMARY KEY (transaction_id)
);

ALTER TABLE analytics_transactions ADD CONSTRAINT analytics_transactions_values_ck CHECK (event_version >= 0 AND held_minutes >= 0 AND status IN ('IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'AUTO_CLOSED') AND classification IN ('SIMPLE', 'COMPLEX', 'HIGHLY_TECHNICAL') AND client_type IN ('STUDENT', 'ALUMNI', 'EMPLOYEE', 'EXTERNAL') AND registry_status IN ('MATCHED', 'EXPIRED', 'NOT_FOUND', 'NONE') AND (outcome IS NULL OR outcome IN ('GRANTED', 'DISAPPROVED')));

CREATE INDEX analytics_transactions_office_started_idx ON analytics_transactions (office_id, started_at DESC);

CREATE INDEX analytics_transactions_service_started_idx ON analytics_transactions (service_id, started_at DESC);

CREATE INDEX analytics_transactions_status_idx ON analytics_transactions (status);

-- One row per backfill job: the committed cursor of the current pass and a lease against overlapping runs.
CREATE TABLE IF NOT EXISTS analytics_backfill_state (
    job_name character varying(40) NOT NULL,
    next_cursor character varying(200),
    pass_started_at timestamp with time zone,
    pass_rows integer NOT NULL DEFAULT 0,
    passes_completed integer NOT NULL DEFAULT 0,
    last_pass_completed_at timestamp with time zone,
    lease_token uuid,
    lease_until timestamp with time zone,
    last_error character varying(500),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT analytics_backfill_state_pkey PRIMARY KEY (job_name)
);

-- Runtime access (default privileges are revoked for the runtime roles; audit_log grants are unchanged):
--   ccms_logs_writer    the running Oversight service: ingest/backfill upsert (no DELETE, no TRUNCATE).
--   ccms_oversight_app  read-only, for the future reports and KPI module.
GRANT SELECT, INSERT, UPDATE ON analytics_transactions TO ccms_logs_writer;

GRANT SELECT ON analytics_transactions TO ccms_oversight_app;

GRANT SELECT, INSERT, UPDATE ON analytics_backfill_state TO ccms_logs_writer;
