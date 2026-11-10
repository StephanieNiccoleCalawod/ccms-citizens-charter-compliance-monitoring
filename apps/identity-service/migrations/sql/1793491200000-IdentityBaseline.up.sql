-- Identity baseline schema (TT1). Generated with pg_dump --schema-only --no-owner --no-privileges from a disposable
-- database built by `db:sync` at commit 64ca621 (the last commit before the Sprint 5 schema changes), then stripped of
-- pg_dump session settings. Where pg_dump's deparsed form of a CHECK or partial-index expression would be stored
-- differently by PostgreSQL when re-executed, the original source expression from after-sync.js / sprint4-critical.js
-- is used instead, so a database built from this file has exactly the catalog definitions of one built by db:sync
-- (verified by scripts/migrations.test.mjs against migrations/baseline-schema.json).
-- FROZEN: never edit after it may have run on the hosted database. Change the schema with a new numbered migration.
CREATE TABLE public.accounts (
    account_id uuid NOT NULL,
    employee_no text NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role_key text NOT NULL,
    office_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accounts_office_rule CHECK ((((role_key = ANY (ARRAY['office_head'::text, 'office_staff'::text])) AND (office_id IS NOT NULL)) OR ((role_key = ANY (ARRAY['super_admin'::text, 'executive'::text])) AND (office_id IS NULL)))),
    CONSTRAINT accounts_role_valid CHECK ((role_key = ANY (ARRAY['super_admin'::text, 'office_head'::text, 'office_staff'::text, 'executive'::text])))
);

CREATE TABLE public.audit_outbox (
    audit_id uuid NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.password_reset_tokens (
    token_hash text NOT NULL,
    account_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.rate_limit_hits (
    key character varying(200) NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    reset_at timestamp with time zone NOT NULL
);

CREATE TABLE public.refresh_tokens (
    token_hash text NOT NULL,
    account_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.audit_outbox
    ADD CONSTRAINT "PK_858edc483f1f20d68122b2db363" PRIMARY KEY (audit_id);

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT "PK_91185d86d5d7557b19abbb2868b" PRIMARY KEY (token_hash);

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "PK_a7838d2ba25be1342091b6695f1" PRIMARY KEY (token_hash);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT "PK_abcd260aa34b3ad2c0ff663dc20" PRIMARY KEY (account_id);

ALTER TABLE ONLY public.rate_limit_hits
    ADD CONSTRAINT "PK_d392e81d922afbaed7efb3f1184" PRIMARY KEY (key);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_employee_no_uq UNIQUE (employee_no);

CREATE UNIQUE INDEX accounts_email_lower_uq ON public.accounts USING btree (lower(email));

CREATE INDEX accounts_office_idx ON public.accounts USING btree (office_id);

CREATE INDEX accounts_role_idx ON public.accounts USING btree (role_key);

CREATE INDEX audit_outbox_unsent_idx ON public.audit_outbox USING btree (created_at) WHERE (sent_at IS NULL);

CREATE INDEX password_reset_tokens_account_idx ON public.password_reset_tokens USING btree (account_id);

CREATE INDEX refresh_tokens_account_idx ON public.refresh_tokens USING btree (account_id);
