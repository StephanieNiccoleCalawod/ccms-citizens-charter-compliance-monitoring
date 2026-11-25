// S8-52 Request Access: the requests and the grants they lead to. Explicit, one advisory lock, safe to run twice.
export async function migrateSprint8Identity(dataSource) {
  await dataSource.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(43436, 801)');
    await manager.query(`CREATE TABLE IF NOT EXISTS access_requests (
      request_id uuid PRIMARY KEY,
      account_id uuid NOT NULL REFERENCES accounts(account_id),
      office_id uuid NOT NULL,
      permission_key text NOT NULL,
      reason text NOT NULL,
      status text NOT NULL DEFAULT 'PENDING',
      requested_at timestamptz NOT NULL DEFAULT now(),
      decided_by uuid,
      decided_at timestamptz,
      decision_note text,
      ends_on date,
      CONSTRAINT access_requests_status_ck CHECK (status IN ('PENDING', 'GRANTED', 'DENIED', 'REVOKED', 'EXPIRED')),
      CONSTRAINT access_requests_key_ck CHECK (permission_key IN ('REPORTS_PER_PERSON', 'RECORD_PAST_TRANSACTIONS', 'EXPORT_CSV', 'VIEW_OFFICE_QUEUE')),
      CONSTRAINT access_requests_grant_end_ck CHECK (status <> 'GRANTED' OR ends_on IS NOT NULL)
    )`);
    await manager.query('CREATE INDEX IF NOT EXISTS access_requests_status_idx ON access_requests (status, requested_at DESC)');
    await manager.query('CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending_uq ON access_requests (account_id, permission_key) WHERE status = \'PENDING\'');
    await manager.query(`CREATE TABLE IF NOT EXISTS account_permission_grants (
      grant_id uuid PRIMARY KEY,
      request_id uuid NOT NULL UNIQUE REFERENCES access_requests(request_id),
      account_id uuid NOT NULL REFERENCES accounts(account_id),
      office_id uuid NOT NULL,
      permission_key text NOT NULL,
      granted_by uuid NOT NULL,
      granted_at timestamptz NOT NULL DEFAULT now(),
      ends_on date NOT NULL,
      status text NOT NULL DEFAULT 'ACTIVE',
      ended_at timestamptz,
      ended_by uuid,
      CONSTRAINT account_permission_grants_status_ck CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
      CONSTRAINT account_permission_grants_key_ck CHECK (permission_key IN ('REPORTS_PER_PERSON', 'RECORD_PAST_TRANSACTIONS', 'EXPORT_CSV', 'VIEW_OFFICE_QUEUE'))
    )`);
    await manager.query('CREATE INDEX IF NOT EXISTS account_permission_grants_account_idx ON account_permission_grants (account_id, status)');
  });
}
