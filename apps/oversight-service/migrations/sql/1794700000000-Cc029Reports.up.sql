-- Sprint 7 CC029/CC030/CC031: office accomplishment reports (Draft -> Published -> Superseded) with the exact runtime grants.
-- Keep identical to ReportRules()/reportGrants() in src/lib/after-sync.js and to the Report entity.
CREATE TABLE IF NOT EXISTS reports (
    report_id uuid NOT NULL,
    office_id uuid NOT NULL,
    office_name character varying(200),
    period_type character varying(12) NOT NULL,
    period_from date NOT NULL,
    period_to date NOT NULL,
    version integer NOT NULL,
    status character varying(12) NOT NULL,
    figures jsonb NOT NULL,
    generated_by uuid NOT NULL,
    generated_at timestamp with time zone NOT NULL DEFAULT now(),
    published_by uuid,
    published_by_name character varying(200),
    published_at timestamp with time zone,
    supersede_reason character varying(500),
    supersedes_report_id uuid,
    CONSTRAINT reports_pkey PRIMARY KEY (report_id)
);

ALTER TABLE reports ADD CONSTRAINT reports_values_ck CHECK (version >= 1 AND status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED') AND period_type IN ('weekly', 'monthly', 'half_year', 'annual', 'custom') AND period_from <= period_to AND ((status = 'DRAFT') = (published_at IS NULL)) AND (status = 'DRAFT' OR published_by IS NOT NULL));

-- One draft and one published report per office and period; a version number is used once.
CREATE UNIQUE INDEX reports_one_draft_uq ON reports (office_id, period_type, period_from, period_to) WHERE status = 'DRAFT';

CREATE UNIQUE INDEX reports_one_published_uq ON reports (office_id, period_type, period_from, period_to) WHERE status = 'PUBLISHED';

CREATE UNIQUE INDEX reports_version_uq ON reports (office_id, period_type, period_from, period_to, version);

CREATE INDEX reports_office_period_idx ON reports (office_id, period_from DESC);

-- Runtime access: the running service (ccms_logs_writer) generates, publishes and supersedes; ccms_oversight_app reads. No DELETE.
GRANT SELECT, INSERT, UPDATE ON reports TO ccms_logs_writer;

GRANT SELECT ON reports TO ccms_oversight_app;
