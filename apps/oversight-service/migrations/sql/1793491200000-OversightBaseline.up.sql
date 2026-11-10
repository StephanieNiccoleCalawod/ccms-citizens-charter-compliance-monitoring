-- Oversight baseline schema (TT1). Generated with pg_dump --schema-only --no-owner --no-privileges from a disposable
-- database built by `db:sync` at commit 64ca621 (the last commit before the Sprint 5 schema changes), then stripped of
-- pg_dump session settings. Where pg_dump's deparsed form of a CHECK or partial-index expression would be stored
-- differently by PostgreSQL when re-executed, the original source expression from after-sync.js / sprint4-critical.js
-- is used instead, so a database built from this file has exactly the catalog definitions of one built by db:sync
-- (verified by scripts/migrations.test.mjs against migrations/baseline-schema.json).
-- FROZEN: never edit after it may have run on the hosted database. Change the schema with a new numbered migration.
CREATE TABLE public.audit_log (
    audit_id uuid NOT NULL,
    actor_user_id uuid,
    actor_role character varying(30) NOT NULL,
    action character varying(80) NOT NULL,
    entity_type character varying(60) NOT NULL,
    entity_id character varying(100),
    entity_name character varying(300),
    office_id uuid,
    before_value jsonb,
    after_value jsonb,
    ip_address character varying(64),
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_log_actor_ck CHECK (((actor_user_id IS NOT NULL) OR ((actor_role)::text = 'system'::text))),
    CONSTRAINT audit_log_entity_name_ck CHECK (entity_name IS NULL OR (char_length(btrim(entity_name)) BETWEEN 1 AND 300 AND entity_name !~ '[[:cntrl:]]'))
);

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT "PK_90d705dc65e834a7bfc79ea4df0" PRIMARY KEY (audit_id);

CREATE INDEX audit_log_action_idx ON public.audit_log USING btree (action);

CREATE INDEX audit_log_actor_idx ON public.audit_log USING btree (actor_user_id);

CREATE INDEX audit_log_entity_type_idx ON public.audit_log USING btree (entity_type);

CREATE INDEX audit_log_occurred_idx ON public.audit_log USING btree (occurred_at DESC);

CREATE INDEX audit_log_office_occurred_idx ON public.audit_log USING btree (office_id, occurred_at DESC);
