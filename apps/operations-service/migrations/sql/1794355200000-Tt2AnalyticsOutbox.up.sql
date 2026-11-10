-- Sprint 5 TT2: the analytics event feed (spec 2.2). Additive only.
-- FROZEN once it may have run on a hosted database; change the schema with a new numbered migration.

-- A counter used only by the analytics feed (not the optimistic-lock "version"). Existing rows start at 0 and are
-- exported with version 0; every later analytics event increments it in the same database transaction.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS analytics_event_version integer NOT NULL DEFAULT 0;

-- Durable delivery of analytics snapshots to Oversight (logical consumer ANALYTICS). Separate from audit_outbox so the
-- two destinations never share delivery state.
CREATE TABLE IF NOT EXISTS analytics_outbox (
    event_id uuid NOT NULL,
    transaction_id uuid NOT NULL,
    event_version integer NOT NULL,
    event_type character varying(40) NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
    lease_token uuid,
    lease_until timestamp with time zone,
    delivered_at timestamp with time zone,
    last_error character varying(500),
    CONSTRAINT analytics_outbox_pkey PRIMARY KEY (event_id)
);

ALTER TABLE analytics_outbox ADD CONSTRAINT analytics_outbox_version_uq UNIQUE (transaction_id, event_version);

ALTER TABLE analytics_outbox ADD CONSTRAINT analytics_outbox_values_ck CHECK (event_version >= 1 AND attempts >= 0 AND event_type IN ('TRANSACTION_STARTED', 'TRANSACTION_HELD', 'TRANSACTION_RESUMED', 'TRANSACTION_COMPLETED', 'TRANSACTION_RESULT_COMPUTED', 'TRANSACTION_CANCELLED', 'TRANSACTION_AUTO_CLOSED'));

CREATE INDEX analytics_outbox_pending_idx ON analytics_outbox (next_attempt_at, created_at) WHERE delivered_at IS NULL;
