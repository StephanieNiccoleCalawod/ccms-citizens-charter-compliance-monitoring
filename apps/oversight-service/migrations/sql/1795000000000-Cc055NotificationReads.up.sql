-- Sprint 7 CC055: which notifications a signed-in user has marked as read. A notification itself is never stored: it is worked out
-- each time it is asked for; only the key (for example "complaint:<id>:RESOLVED") of one the user has read is kept here.
-- Keep identical to notificationRules()/notificationGrants() in src/lib/after-sync.js and to the NotificationRead entity.
CREATE TABLE IF NOT EXISTS notification_reads (
    user_id uuid NOT NULL,
    notification_key character varying(200) NOT NULL,
    read_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT notification_reads_pkey PRIMARY KEY (user_id, notification_key)
);

CREATE INDEX notification_reads_read_idx ON notification_reads (read_at);

-- Runtime access: the running service (ccms_logs_writer) records a read and removes reads older than 30 days. No UPDATE.
GRANT SELECT, INSERT, DELETE ON notification_reads TO ccms_logs_writer;
