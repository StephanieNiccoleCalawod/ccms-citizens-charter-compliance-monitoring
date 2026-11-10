-- Operations baseline schema (TT1). Generated with pg_dump --schema-only --no-owner --no-privileges from a disposable
-- database built by `db:sync` at commit 64ca621 (the last commit before the Sprint 5 schema changes), then stripped of
-- pg_dump session settings. Where pg_dump's deparsed form of a CHECK or partial-index expression would be stored
-- differently by PostgreSQL when re-executed, the original source expression from after-sync.js / sprint4-critical.js
-- is used instead, so a database built from this file has exactly the catalog definitions of one built by db:sync
-- (verified by scripts/migrations.test.mjs against migrations/baseline-schema.json).
-- FROZEN: never edit after it may have run on the hosted database. Change the schema with a new numbered migration.
CREATE TABLE public.audit_outbox (
    audit_id uuid NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.counters (
    counter_id uuid NOT NULL,
    office_id uuid NOT NULL,
    label character varying(50) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT counters_label_ck CHECK (((char_length(btrim((label)::text)) >= 1) AND (char_length(btrim((label)::text)) <= 50)))
);

CREATE TABLE public.rate_limit_hits (
    key character varying(200) NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    reset_at timestamp with time zone NOT NULL
);

CREATE TABLE public.tracking_sequences (
    office_id uuid NOT NULL,
    seq_date date NOT NULL,
    last_seq integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.transaction_settings (
    id smallint NOT NULL,
    hold_enabled boolean DEFAULT false NOT NULL,
    counters_enabled boolean DEFAULT false NOT NULL,
    auto_close_days_simple integer,
    auto_close_days_complex integer,
    auto_close_days_highly_technical integer,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT transaction_settings_auto_close_days_complex_ck CHECK (((auto_close_days_complex IS NULL) OR ((auto_close_days_complex >= 1) AND (auto_close_days_complex <= 365)))),
    CONSTRAINT transaction_settings_auto_close_days_highly_technical_ck CHECK (((auto_close_days_highly_technical IS NULL) OR ((auto_close_days_highly_technical >= 1) AND (auto_close_days_highly_technical <= 365)))),
    CONSTRAINT transaction_settings_auto_close_days_simple_ck CHECK (((auto_close_days_simple IS NULL) OR ((auto_close_days_simple >= 1) AND (auto_close_days_simple <= 365)))),
    CONSTRAINT transaction_settings_single_ck CHECK ((id = 1)),
    CONSTRAINT transaction_settings_version_ck CHECK ((version >= 1))
);

CREATE TABLE public.transactions (
    transaction_id uuid NOT NULL,
    tracking_no character varying(60) NOT NULL,
    service_id uuid NOT NULL,
    service_code text NOT NULL,
    service_name text NOT NULL,
    office_id uuid NOT NULL,
    office_code character varying(20) NOT NULL,
    office_name text,
    service_classification character varying(20) NOT NULL,
    standard_id uuid NOT NULL,
    standard_duration_days integer NOT NULL,
    standard_duration_hours integer NOT NULL,
    standard_duration_minutes integer NOT NULL,
    counter_id uuid,
    client_type character varying(20) NOT NULL,
    client_reference character varying(100),
    client_email character varying(254),
    started_at timestamp with time zone NOT NULL,
    started_by uuid NOT NULL,
    ended_at timestamp with time zone,
    ended_by uuid,
    status character varying(20) NOT NULL,
    elapsed_working_minutes integer,
    is_compliant boolean,
    variance_minutes integer,
    cancel_reason text,
    backdate_reason text,
    is_backdated boolean DEFAULT false NOT NULL,
    held_minutes integer DEFAULT 0 NOT NULL,
    hold_reason text,
    hold_started_at timestamp with time zone,
    queue_ticket_id uuid,
    queue_wait_minutes integer,
    receipt_email_status character varying(10) DEFAULT 'NONE'::character varying NOT NULL,
    receipt_email_attempts integer DEFAULT 0 NOT NULL,
    receipt_email_claim_token uuid,
    receipt_email_claim_until timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT transactions_cancel_reason_ck CHECK (((((status)::text <> 'CANCELLED'::text) OR (cancel_reason IS NOT NULL)) AND ((cancel_reason IS NULL) OR ((char_length(btrim(cancel_reason)) >= 1) AND (char_length(btrim(cancel_reason)) <= 500))))),
    CONSTRAINT transactions_classification_ck CHECK (service_classification IN ('SIMPLE', 'COMPLEX', 'HIGHLY_TECHNICAL')),
    CONSTRAINT transactions_client_type_ck CHECK (client_type IN ('STUDENT', 'ALUMNI', 'EMPLOYEE', 'EXTERNAL')),
    CONSTRAINT transactions_held_ck CHECK ((held_minutes >= 0)),
    CONSTRAINT transactions_hold_ck CHECK ((((status)::text = 'ON_HOLD'::text) = (hold_started_at IS NOT NULL))),
    CONSTRAINT transactions_receipt_status_ck CHECK (
      receipt_email_status IN ('NONE','PENDING','SENDING','SENT','FAILED') AND receipt_email_attempts >= 0 AND
      ((receipt_email_status = 'SENDING' AND receipt_email_claim_token IS NOT NULL AND receipt_email_claim_until IS NOT NULL) OR
       (receipt_email_status <> 'SENDING' AND receipt_email_claim_token IS NULL AND receipt_email_claim_until IS NULL))),
    CONSTRAINT transactions_standard_ck CHECK (((standard_duration_days >= 0) AND (standard_duration_hours >= 0) AND (standard_duration_minutes >= 0))),
    CONSTRAINT transactions_status_ck CHECK (status IN ('IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'AUTO_CLOSED')),
    CONSTRAINT transactions_version_ck CHECK ((version >= 1))
);

ALTER TABLE ONLY public.tracking_sequences
    ADD CONSTRAINT "PK_0b3fce9ebf2397d7787f930c8af" PRIMARY KEY (office_id, seq_date);

ALTER TABLE ONLY public.counters
    ADD CONSTRAINT "PK_3c5b829acea769d5f871cbda951" PRIMARY KEY (counter_id);

ALTER TABLE ONLY public.audit_outbox
    ADD CONSTRAINT "PK_858edc483f1f20d68122b2db363" PRIMARY KEY (audit_id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT "PK_9162bf9ab4e31961a8f7932974c" PRIMARY KEY (transaction_id);

ALTER TABLE ONLY public.rate_limit_hits
    ADD CONSTRAINT "PK_d392e81d922afbaed7efb3f1184" PRIMARY KEY (key);

ALTER TABLE ONLY public.transaction_settings
    ADD CONSTRAINT "PK_db7fb38a439358b499ebdee4761" PRIMARY KEY (id);

CREATE INDEX audit_outbox_unsent_idx ON public.audit_outbox USING btree (created_at) WHERE (sent_at IS NULL);

CREATE UNIQUE INDEX counters_office_label_uq ON public.counters USING btree (office_id, lower((label)::text));

CREATE INDEX transactions_office_started_idx ON public.transactions USING btree (office_id, started_at DESC);

CREATE UNIQUE INDEX transactions_one_open_per_counter_uq ON public.transactions USING btree (counter_id) WHERE counter_id IS NOT NULL AND status IN ('IN_PROGRESS', 'ON_HOLD');

CREATE UNIQUE INDEX transactions_one_open_per_staff_uq ON public.transactions USING btree (started_by) WHERE status IN ('IN_PROGRESS', 'ON_HOLD');

CREATE INDEX transactions_open_started_idx ON public.transactions USING btree (status, started_at) WHERE status IN ('IN_PROGRESS', 'ON_HOLD');

CREATE INDEX transactions_pending_result_idx ON public.transactions USING btree (status) WHERE (elapsed_working_minutes IS NULL);

CREATE INDEX transactions_staff_started_idx ON public.transactions USING btree (started_by, started_at DESC);

CREATE INDEX transactions_status_idx ON public.transactions USING btree (status);

CREATE UNIQUE INDEX transactions_tracking_no_uq ON public.transactions USING btree (tracking_no);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_counter_fk FOREIGN KEY (counter_id) REFERENCES public.counters(counter_id);
