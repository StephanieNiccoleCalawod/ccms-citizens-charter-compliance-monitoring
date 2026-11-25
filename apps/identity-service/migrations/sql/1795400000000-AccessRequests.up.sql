-- S8-52 Request Access (D-AC-4): the requests a person makes for one of four extra permissions, and the time-limited grants they lead
-- to. No foreign keys (the accounts and the office belong to this service and to Core; the code checks them). Keep identical to the
-- AccessRequest and AccountPermissionGrant entities and to the CHECK constraints added in after-sync.
CREATE TABLE IF NOT EXISTS access_requests (
    request_id uuid NOT NULL,
    account_id uuid NOT NULL,
    office_id uuid NOT NULL,
    permission_key text NOT NULL,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    requested_at timestamp with time zone NOT NULL DEFAULT now(),
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_note text,
    ends_on date,
    CONSTRAINT access_requests_pkey PRIMARY KEY (request_id),
    CONSTRAINT access_requests_status_ck CHECK (status IN ('PENDING', 'GRANTED', 'DENIED', 'REVOKED', 'EXPIRED')),
    CONSTRAINT access_requests_key_ck CHECK (permission_key IN ('REPORTS_PER_PERSON', 'RECORD_PAST_TRANSACTIONS', 'EXPORT_CSV', 'VIEW_OFFICE_QUEUE')),
    CONSTRAINT access_requests_grant_end_ck CHECK (status <> 'GRANTED' OR ends_on IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS access_requests_status_idx ON access_requests (status, requested_at);
-- One waiting request per person and permission.
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending_uq ON access_requests (account_id, permission_key) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS account_permission_grants (
    grant_id uuid NOT NULL,
    request_id uuid NOT NULL,
    account_id uuid NOT NULL,
    office_id uuid NOT NULL,
    permission_key text NOT NULL,
    granted_by uuid NOT NULL,
    granted_at timestamp with time zone NOT NULL DEFAULT now(),
    ends_on date NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    ended_at timestamp with time zone,
    ended_by uuid,
    CONSTRAINT account_permission_grants_pkey PRIMARY KEY (grant_id),
    CONSTRAINT account_permission_grants_request_uq UNIQUE (request_id),
    CONSTRAINT account_permission_grants_status_ck CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
    CONSTRAINT account_permission_grants_key_ck CHECK (permission_key IN ('REPORTS_PER_PERSON', 'RECORD_PAST_TRANSACTIONS', 'EXPORT_CSV', 'VIEW_OFFICE_QUEUE'))
);
CREATE INDEX IF NOT EXISTS account_permission_grants_account_idx ON account_permission_grants (account_id, status);
