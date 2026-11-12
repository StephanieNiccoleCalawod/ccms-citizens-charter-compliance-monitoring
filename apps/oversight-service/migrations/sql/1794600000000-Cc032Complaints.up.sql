-- Sprint 6 CC032/CC033: public complaints (filed without an account, checked by reference) and the shared rate-limit counter.
-- Keep identical to complaintRules()/complaintGrants() in src/lib/after-sync.js and to the Complaint entity.
CREATE TABLE IF NOT EXISTS complaints (
    complaint_id uuid NOT NULL,
    reference character varying(20) NOT NULL,
    office_id uuid NOT NULL,
    category character varying(40) NOT NULL,
    description character varying(2000) NOT NULL,
    tracking_no character varying(60),
    complainant_name character varying(200),
    complainant_email character varying(254),
    status character varying(20) NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT complaints_pkey PRIMARY KEY (complaint_id),
    CONSTRAINT complaints_reference_uq UNIQUE (reference)
);

CREATE INDEX complaints_office_created_idx ON complaints (office_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limit_hits (
    key character varying(200) NOT NULL,
    count integer NOT NULL DEFAULT 0,
    reset_at timestamp with time zone NOT NULL,
    CONSTRAINT rate_limit_hits_pkey PRIMARY KEY (key)
);

-- Runtime access: the running service (ccms_logs_writer) files complaints and counts requests; ccms_oversight_app reads complaints.
GRANT SELECT, INSERT ON complaints TO ccms_logs_writer;

GRANT SELECT ON complaints TO ccms_oversight_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_hits TO ccms_logs_writer;
