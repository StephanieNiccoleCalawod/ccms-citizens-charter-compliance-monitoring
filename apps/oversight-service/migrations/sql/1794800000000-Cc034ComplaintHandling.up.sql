-- Sprint 7 CC034/CC035: staff handling of complaints (Received -> Acknowledged -> Resolved with a written reply).
-- Keep identical to complaintRules()/complaintGrants() in src/lib/after-sync.js and to the Complaint entity.
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS due_at timestamp with time zone;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS acknowledged_at timestamp with time zone;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS acknowledged_by uuid;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolved_at timestamp with time zone;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolved_by uuid;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS reply character varying(2000);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_status_ck' AND conrelid = 'complaints'::regclass) THEN
        ALTER TABLE complaints ADD CONSTRAINT complaints_status_ck CHECK (status IN ('RECEIVED', 'ACKNOWLEDGED', 'RESOLVED') AND ((status = 'RECEIVED') = (acknowledged_at IS NULL)) AND ((status = 'RESOLVED') = (resolved_at IS NOT NULL)) AND (status <> 'RESOLVED' OR (reply IS NOT NULL AND char_length(btrim(reply)) >= 1)));
    END IF;
END $$;

-- The running service now updates a complaint's status. Still no DELETE.
GRANT SELECT, INSERT, UPDATE ON complaints TO ccms_logs_writer;
