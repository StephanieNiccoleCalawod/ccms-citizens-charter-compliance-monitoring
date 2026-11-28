// D-AC-7: classify active Charter services and audit each correction in the same transaction.
export const FEE_BACKFILL_SQL = `WITH candidates AS (
  SELECT s.service_id, s.office_id, s.service_name, s.has_fee AS previous_fee,
    s.service_code IN ('PUP-ACCT-CLR-001', 'PUP-ADMREG-ACC-003', 'PUP-ADMREG-ADM-001') AS desired_fee
  FROM services s
  WHERE s.is_active
    AND (lower(regexp_replace(coalesce(s.fees, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g')) IN ('', 'none')
      OR s.service_code IN ('PUP-REG-CRD-005', 'PUP-ACCT-CLR-001', 'PUP-ADMREG-ACC-003', 'PUP-ADMREG-ADM-001'))
    AND NOT EXISTS (
      SELECT 1 FROM audit_outbox a
      WHERE a.payload->>'action' = 'SERVICE_UPDATED'
        AND lower(a.payload->>'actor_role') = 'super_admin'
        AND a.payload->>'entity_id' = s.service_id::text
        AND a.payload->'after_value'->>'has_fee' = 'true'
        AND a.payload->'before_value'->>'has_fee' IS DISTINCT FROM 'true'
    )
), changed AS (
  UPDATE services s SET has_fee = c.desired_fee
  FROM candidates c
  WHERE s.service_id = c.service_id AND s.has_fee IS DISTINCT FROM c.desired_fee
  RETURNING s.service_id, s.office_id, s.service_name, c.previous_fee, s.has_fee
), audit_rows AS (
  SELECT gen_random_uuid() AS audit_id, changed.* FROM changed
), audited AS (
  INSERT INTO audit_outbox (audit_id, payload)
  SELECT audit_id, jsonb_build_object(
    'audit_id', audit_id,
    'actor_user_id', '00000000-0000-0000-0000-000000000000',
    'actor_role', 'super_admin',
    'action', 'SERVICE_UPDATED',
    'entity_type', 'Service',
    'entity_id', service_id::text,
    'entity_name', service_name,
    'office_id', office_id,
    'before_value', jsonb_build_object('service_id', service_id, 'has_fee', previous_fee),
    'after_value', jsonb_build_object('service_id', service_id, 'has_fee', has_fee,
      'reason', 'D-AC-7 Charter fee backfill approved by PM'),
    'ip_address', NULL,
    'occurred_at', clock_timestamp()
  ) FROM audit_rows RETURNING audit_id
)
SELECT (SELECT count(*) FROM changed)::int AS changed_services,
  (SELECT count(*) FROM audited)::int AS audit_events`;

export class S858CharterFeeBackfill1795852800000 {
  name = 'S858CharterFeeBackfill1795852800000';

  async up(runner) {
    // Wait for catalogue edits before reading their audit events and changing fee flags.
    await runner.query('LOCK TABLE services IN SHARE ROW EXCLUSIVE MODE');
    await runner.query(FEE_BACKFILL_SQL);
  }

  async down() {
    // Keep corrected classifications and any subsequent administrator changes.
  }
}
