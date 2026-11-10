-- Core baseline schema (TT1). Generated with pg_dump --schema-only --no-owner --no-privileges from a disposable
-- database built by `db:sync` at commit 64ca621 (the last commit before the Sprint 5 schema changes), then stripped of
-- pg_dump session settings. Where pg_dump's deparsed form of a CHECK or partial-index expression would be stored
-- differently by PostgreSQL when re-executed, the original source expression from after-sync.js / sprint4-critical.js
-- is used instead, so a database built from this file has exactly the catalog definitions of one built by db:sync
-- (verified by scripts/migrations.test.mjs against migrations/baseline-schema.json).
-- FROZEN: never edit after it may have run on the hosted database. Change the schema with a new numbered migration.
CREATE FUNCTION public.ccms_freeze_list_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN RAISE EXCEPTION 'The office freeze list is append-only' USING ERRCODE = '23514'; END $$;

CREATE FUNCTION public.ccms_frozen_office_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM office_list_freeze WHERE office_id = OLD.office_id) THEN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'A frozen office cannot be deleted: deactivate it instead' USING ERRCODE = '23514';
        END IF;
        IF NEW.office_id IS DISTINCT FROM OLD.office_id THEN
          RAISE EXCEPTION 'The ID of a frozen office cannot change' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$;

CREATE FUNCTION public.ccms_institution_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND OLD.institution_code IS NOT NULL THEN
          RAISE EXCEPTION 'Institution setup cannot be deleted' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.institution_code IS NOT NULL AND NEW.institution_code IS DISTINCT FROM OLD.institution_code THEN
          RAISE EXCEPTION 'Institution code is immutable' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END $$;

CREATE FUNCTION public.ccms_service_code_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF NEW.service_code IS DISTINCT FROM OLD.service_code AND current_setting('ccms.legacy_recode', true) IS DISTINCT FROM 'on' THEN
          RAISE EXCEPTION 'Service code is immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;

CREATE TABLE public.audit_outbox (
    audit_id uuid NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.calendar_exceptions (
    exception_id uuid NOT NULL,
    exception_date date NOT NULL,
    exception_type text NOT NULL,
    applies_to text DEFAULT 'BOTH'::text NOT NULL,
    class_mode text DEFAULT 'SUSPENDED'::text,
    description text DEFAULT ''::text NOT NULL,
    office_id uuid,
    suspended_from text,
    suspended_until text,
    revision integer DEFAULT 1 NOT NULL,
    removed_at timestamp with time zone,
    is_recurring boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_exception_class_mode_ck CHECK (((applies_to = ANY (ARRAY['WORK'::text, 'CLASSES'::text, 'BOTH'::text])) AND (((applies_to = 'WORK'::text) AND (class_mode IS NULL)) OR ((applies_to = ANY (ARRAY['CLASSES'::text, 'BOTH'::text])) AND (class_mode IS NOT NULL) AND (class_mode = ANY (ARRAY['SUSPENDED'::text, 'ONLINE'::text])))))),
    CONSTRAINT calendar_exceptions_recurring_ck CHECK (((is_recurring = false) OR (exception_type <> 'SUSPENSION'::text))),
    CONSTRAINT calendar_exceptions_revision_ck CHECK ((revision >= 1)),
    CONSTRAINT calendar_exceptions_suspended_from_ck CHECK (((suspended_from IS NULL) OR (suspended_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text))),
    CONSTRAINT calendar_exceptions_suspended_until_ck CHECK (((suspended_until IS NULL) OR ((suspended_until ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text) AND (suspended_from IS NOT NULL) AND (suspended_until > suspended_from)))),
    CONSTRAINT calendar_exceptions_type_ck CHECK ((exception_type = ANY (ARRAY['REGULAR_HOLIDAY'::text, 'SPECIAL_NON_WORKING'::text, 'SUSPENSION'::text, 'LOCAL_HOLIDAY'::text])))
);

CREATE TABLE public.catalogue_settings (
    id smallint DEFAULT '1'::smallint NOT NULL,
    institution_code text,
    applies_to_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT catalogue_settings_code_ck CHECK (((institution_code IS NULL) OR (institution_code ~ '^[A-Z0-9]{2,10}$'::text))),
    CONSTRAINT catalogue_settings_single_ck CHECK ((id = 1))
);

CREATE TABLE public.machine_keys (
    key_id uuid NOT NULL,
    key_ref text NOT NULL,
    key_hash text NOT NULL,
    caller text NOT NULL,
    environment text NOT NULL,
    scope text NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    replaced_by uuid,
    created_by text,
    CONSTRAINT machine_keys_caller_ck CHECK ((caller = ANY (ARRAY['FMS'::text, 'SMS'::text]))),
    CONSTRAINT machine_keys_environment_ck CHECK ((environment = ANY (ARRAY['development'::text, 'test'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT machine_keys_scope_ck CHECK ((scope = 'read-calendar'::text))
);

CREATE TABLE public.office_list_freeze (
    office_id uuid NOT NULL,
    office_code text NOT NULL,
    frozen_at timestamp with time zone DEFAULT now() NOT NULL,
    frozen_by text
);

CREATE TABLE public.offices (
    office_id uuid NOT NULL,
    office_code text NOT NULL,
    office_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.rate_limit_hits (
    key character varying(200) NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    reset_at timestamp with time zone NOT NULL
);

CREATE TABLE public.required_documents (
    document_id uuid NOT NULL,
    service_id uuid NOT NULL,
    document_name text NOT NULL,
    document_name_key text NOT NULL,
    is_mandatory boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.service_code_sequences (
    office_id uuid NOT NULL,
    service_abbr text NOT NULL,
    last_seq integer NOT NULL,
    CONSTRAINT service_code_sequence_range_ck CHECK (((last_seq >= 1) AND (last_seq <= 999)))
);

CREATE TABLE public.service_standards (
    standard_id uuid NOT NULL,
    service_id uuid NOT NULL,
    version_no integer NOT NULL,
    duration_days integer DEFAULT 0 NOT NULL,
    duration_hours integer DEFAULT 0 NOT NULL,
    duration_minutes integer DEFAULT 0 NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    charter_reference text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_standards_duration_ck CHECK (
      duration_days BETWEEN 0 AND 1000000
      AND duration_hours BETWEEN 0 AND 1000000
      AND duration_minutes BETWEEN 0 AND 1000000
      AND (duration_days > 0 OR duration_hours > 0 OR duration_minutes > 0)
      AND version_no >= 1
    ),
    CONSTRAINT service_standards_range_ck CHECK (((effective_to IS NULL) OR (effective_to >= effective_from)))
);

CREATE TABLE public.services (
    service_id uuid NOT NULL,
    office_id uuid NOT NULL,
    service_code text NOT NULL,
    service_name text NOT NULL,
    service_name_key text NOT NULL,
    classification text NOT NULL,
    service_scope text NOT NULL,
    transaction_types text[] NOT NULL,
    measurement_type text DEFAULT 'TIMELINESS'::text NOT NULL,
    processing_steps text,
    fees text,
    who_may_avail text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT services_classification_ck CHECK ((classification = ANY (ARRAY['SIMPLE'::text, 'COMPLEX'::text, 'HIGHLY_TECHNICAL'::text]))),
    CONSTRAINT services_measurement_ck CHECK ((measurement_type = 'TIMELINESS'::text)),
    CONSTRAINT services_scope_ck CHECK ((service_scope = ANY (ARRAY['INTERNAL'::text, 'EXTERNAL'::text]))),
    CONSTRAINT services_transaction_types_ck CHECK (((cardinality(transaction_types) >= 1) AND (transaction_types <@ ARRAY['G2C'::text, 'G2G'::text, 'G2B'::text])))
);

CREATE TABLE public.sync_log (
    sync_id uuid NOT NULL,
    consumer_system text NOT NULL,
    event_type text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    payload jsonb NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    last_attempt_at timestamp with time zone,
    last_synced_at timestamp with time zone,
    reply jsonb,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sync_log_consumer_ck CHECK ((consumer_system = ANY (ARRAY['FMS'::text, 'AUDIT'::text]))),
    CONSTRAINT sync_log_status_ck CHECK ((status = ANY (ARRAY['PENDING'::text, 'SENT'::text, 'ACKNOWLEDGED'::text, 'FAILED'::text, 'SUPERSEDED'::text])))
);

CREATE TABLE public.term_dates (
    term_id uuid NOT NULL,
    term_name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT term_dates_range_ck CHECK ((end_date > start_date))
);

CREATE TABLE public.working_hours (
    day_of_week integer NOT NULL,
    is_working boolean DEFAULT false NOT NULL,
    opening_time text,
    closing_time text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT working_hours_day_ck CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT working_hours_times_ck CHECK ((((is_working = false) AND (opening_time IS NULL) AND (closing_time IS NULL)) OR ((is_working = true) AND (opening_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text) AND (closing_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text) AND (closing_time > opening_time))))
);

ALTER TABLE ONLY public.working_hours
    ADD CONSTRAINT "PK_2e70cc597c765e887bc8995a42b" PRIMARY KEY (day_of_week);

ALTER TABLE ONLY public.catalogue_settings
    ADD CONSTRAINT "PK_5394d7fa3fdaf2a433d43892f9d" PRIMARY KEY (id);

ALTER TABLE ONLY public.service_standards
    ADD CONSTRAINT "PK_580e7c181c511ba28b116a74108" PRIMARY KEY (standard_id);

ALTER TABLE ONLY public.audit_outbox
    ADD CONSTRAINT "PK_858edc483f1f20d68122b2db363" PRIMARY KEY (audit_id);

ALTER TABLE ONLY public.required_documents
    ADD CONSTRAINT "PK_8aee0e7d20c12c324f4f867c488" PRIMARY KEY (document_id);

ALTER TABLE ONLY public.offices
    ADD CONSTRAINT "PK_9381e6f381754cfe5b9e7d44663" PRIMARY KEY (office_id);

ALTER TABLE ONLY public.sync_log
    ADD CONSTRAINT "PK_99b79c9b215fddaedb649d113d8" PRIMARY KEY (sync_id);

ALTER TABLE ONLY public.service_code_sequences
    ADD CONSTRAINT "PK_ad0e7810d435a8f2312508d648e" PRIMARY KEY (office_id, service_abbr);

ALTER TABLE ONLY public.calendar_exceptions
    ADD CONSTRAINT "PK_cadec9ed0845fecb0e597a1cc1e" PRIMARY KEY (exception_id);

ALTER TABLE ONLY public.rate_limit_hits
    ADD CONSTRAINT "PK_d392e81d922afbaed7efb3f1184" PRIMARY KEY (key);

ALTER TABLE ONLY public.term_dates
    ADD CONSTRAINT "PK_dcf46a3984f22ba77a5068f4bfa" PRIMARY KEY (term_id);

ALTER TABLE ONLY public.services
    ADD CONSTRAINT "PK_ef0531b9789b488593690ab8d5d" PRIMARY KEY (service_id);

ALTER TABLE ONLY public.machine_keys
    ADD CONSTRAINT "PK_ef7a1c90119ada680f740c4ef67" PRIMARY KEY (key_id);

ALTER TABLE ONLY public.machine_keys
    ADD CONSTRAINT "UQ_03331b478fa6a0b9bdef3517562" UNIQUE (key_ref);

ALTER TABLE public.calendar_exceptions
    ADD CONSTRAINT calendar_exceptions_office_work_ck CHECK (((office_id IS NULL) OR (applies_to = 'WORK'::text))) NOT VALID;

ALTER TABLE ONLY public.office_list_freeze
    ADD CONSTRAINT office_list_freeze_pkey PRIMARY KEY (office_id);

ALTER TABLE ONLY public.term_dates
    ADD CONSTRAINT term_dates_no_overlap EXCLUDE USING gist (daterange(start_date, end_date, '[]'::text) WITH &&);

CREATE INDEX audit_outbox_unsent_idx ON public.audit_outbox USING btree (created_at) WHERE (sent_at IS NULL);

CREATE INDEX calendar_exceptions_date_idx ON public.calendar_exceptions USING btree (exception_date);

CREATE UNIQUE INDEX calendar_exceptions_scope_date_uq ON public.calendar_exceptions USING btree (office_id, exception_date) NULLS NOT DISTINCT WHERE (removed_at IS NULL);

CREATE UNIQUE INDEX offices_code_lower_uq ON public.offices USING btree (lower(office_code));

CREATE UNIQUE INDEX required_documents_name_uq ON public.required_documents USING btree (service_id, document_name_key);

CREATE INDEX required_documents_service_idx ON public.required_documents USING btree (service_id);

CREATE UNIQUE INDEX service_standards_from_uq ON public.service_standards USING btree (service_id, effective_from);

CREATE INDEX service_standards_service_idx ON public.service_standards USING btree (service_id);

CREATE UNIQUE INDEX service_standards_version_uq ON public.service_standards USING btree (service_id, version_no);

CREATE UNIQUE INDEX services_code_lower_uq ON public.services USING btree (lower(service_code));

CREATE INDEX services_office_idx ON public.services USING btree (office_id);

CREATE UNIQUE INDEX services_office_name_uq ON public.services USING btree (office_id, service_name_key);

CREATE INDEX sync_log_created_idx ON public.sync_log USING btree (created_at);

CREATE INDEX sync_log_due_idx ON public.sync_log USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['PENDING'::text, 'FAILED'::text]));

CREATE TRIGGER catalogue_institution_immutable BEFORE DELETE OR UPDATE ON public.catalogue_settings FOR EACH ROW EXECUTE FUNCTION public.ccms_institution_immutable();

CREATE TRIGGER office_list_freeze_append_only BEFORE DELETE OR UPDATE ON public.office_list_freeze FOR EACH ROW EXECUTE FUNCTION public.ccms_freeze_list_append_only();

CREATE TRIGGER offices_frozen_guard BEFORE DELETE OR UPDATE ON public.offices FOR EACH ROW EXECUTE FUNCTION public.ccms_frozen_office_guard();

CREATE TRIGGER services_code_immutable BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.ccms_service_code_immutable();

ALTER TABLE ONLY public.required_documents
    ADD CONSTRAINT required_documents_service_fk FOREIGN KEY (service_id) REFERENCES public.services(service_id);

ALTER TABLE ONLY public.service_standards
    ADD CONSTRAINT service_standards_service_fk FOREIGN KEY (service_id) REFERENCES public.services(service_id);

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_office_fk FOREIGN KEY (office_id) REFERENCES public.offices(office_id);
