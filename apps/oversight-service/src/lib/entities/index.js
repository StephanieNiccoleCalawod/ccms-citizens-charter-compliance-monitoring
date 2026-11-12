import { EntitySchema } from 'typeorm';

// ---- Logs (ERD section 8, with the Sprint 4 approvals of 10/18, Decision G15) ----

// One audit entry, written once and never changed (D6): UPDATE, DELETE and TRUNCATE are not granted to any
// application role (src/lib/after-sync.js). audit_id is the id the sending service made, so a re-sent event is
// recognised and ignored. There are no foreign keys: user and office are plain IDs owned by other services.
// entity_id is text (UUIDs and "campus" are both valid) and actor_role also allows "system".
// The (occurred_at DESC) and (office_id, occurred_at DESC) indexes and the actor CHECK are created in after-sync.
export const AuditLog = new EntitySchema({
  name: 'AuditLog',
  tableName: 'audit_log',
  columns: {
    auditId: { name: 'audit_id', type: 'uuid', primary: true },
    actorUserId: { name: 'actor_user_id', type: 'uuid', nullable: true },
    actorRole: { name: 'actor_role', type: 'varchar', length: 30 },
    action: { type: 'varchar', length: 80 },
    entityType: { name: 'entity_type', type: 'varchar', length: 60 },
    entityId: { name: 'entity_id', type: 'varchar', length: 100, nullable: true },
    entityName: { name: 'entity_name', type: 'varchar', length: 300, nullable: true },
    officeId: { name: 'office_id', type: 'uuid', nullable: true },
    beforeValue: { name: 'before_value', type: 'jsonb', nullable: true },
    afterValue: { name: 'after_value', type: 'jsonb', nullable: true },
    ipAddress: { name: 'ip_address', type: 'varchar', length: 64, nullable: true },
    occurredAt: { name: 'occurred_at', type: 'timestamptz' },
    receivedAt: { name: 'received_at', type: 'timestamptz', default: () => 'now()' },
  },
  indices: [
    { name: 'audit_log_action_idx', columns: ['action'] },
    { name: 'audit_log_entity_type_idx', columns: ['entityType'] },
    { name: 'audit_log_actor_idx', columns: ['actorUserId'] },
  ],
});

// ---- TT2 analytics projection (spec 2.2) ----
// One row per transaction: the snapshot with the highest event_version received from Operations (live feed or backfill).
// Field meanings are in ccms-shared/src/analytics.js. is_seeded is derived here from the tracking number (K16).
// The CHECK, the indexes and the grants are created in after-sync / the TT2 migration. No foreign keys: every ID is a
// value owned by another service.
export const AnalyticsTransaction = new EntitySchema({
  name: 'AnalyticsTransaction',
  tableName: 'analytics_transactions',
  columns: {
    transactionId: { name: 'transaction_id', type: 'uuid', primary: true, primaryKeyConstraintName: 'analytics_transactions_pkey' },
    trackingNo: { name: 'tracking_no', type: 'varchar', length: 60 },
    officeId: { name: 'office_id', type: 'uuid' },
    serviceId: { name: 'service_id', type: 'uuid' },
    serviceCode: { name: 'service_code', type: 'varchar', length: 200 },
    classification: { type: 'varchar', length: 20 },
    clientType: { name: 'client_type', type: 'varchar', length: 20 },
    standardDays: { name: 'standard_days', type: 'int' },
    standardHours: { name: 'standard_hours', type: 'int' },
    standardMinutes: { name: 'standard_minutes', type: 'int' },
    startedAt: { name: 'started_at', type: 'timestamptz' },
    endedAt: { name: 'ended_at', type: 'timestamptz', nullable: true },
    status: { type: 'varchar', length: 20 },
    elapsedWorkingMinutes: { name: 'elapsed_working_minutes', type: 'int', nullable: true },
    isCompliant: { name: 'is_compliant', type: 'boolean', nullable: true },
    varianceMinutes: { name: 'variance_minutes', type: 'int', nullable: true },
    heldMinutes: { name: 'held_minutes', type: 'int' },
    isBackdated: { name: 'is_backdated', type: 'boolean' },
    startedOutsideHours: { name: 'started_outside_hours', type: 'boolean' },
    registryStatus: { name: 'registry_status', type: 'varchar', length: 12 },
    registryMissReason: { name: 'registry_miss_reason', type: 'varchar', length: 20, nullable: true },
    outcome: { type: 'varchar', length: 12, nullable: true },
    startedByUserId: { name: 'started_by_user_id', type: 'uuid' },
    endedByUserId: { name: 'ended_by_user_id', type: 'uuid', nullable: true },
    counterId: { name: 'counter_id', type: 'uuid', nullable: true },
    eventVersion: { name: 'event_version', type: 'int' },
    isSeeded: { name: 'is_seeded', type: 'boolean' },
    receivedAt: { name: 'received_at', type: 'timestamptz', default: () => 'now()' },
  },
});

// TT2 backfill progress: the committed cursor of the current pass and a lease that stops overlapping runs.
export const AnalyticsBackfillState = new EntitySchema({
  name: 'AnalyticsBackfillState',
  tableName: 'analytics_backfill_state',
  columns: {
    jobName: { name: 'job_name', type: 'varchar', length: 40, primary: true, primaryKeyConstraintName: 'analytics_backfill_state_pkey' },
    nextCursor: { name: 'next_cursor', type: 'varchar', length: 200, nullable: true },
    passStartedAt: { name: 'pass_started_at', type: 'timestamptz', nullable: true },
    passRows: { name: 'pass_rows', type: 'int', default: 0 },
    passesCompleted: { name: 'passes_completed', type: 'int', default: 0 },
    lastPassCompletedAt: { name: 'last_pass_completed_at', type: 'timestamptz', nullable: true },
    leaseToken: { name: 'lease_token', type: 'uuid', nullable: true },
    leaseUntil: { name: 'lease_until', type: 'timestamptz', nullable: true },
    lastError: { name: 'last_error', type: 'varchar', length: 500, nullable: true },
    updatedAt: { name: 'updated_at', type: 'timestamptz', default: () => 'now()' },
  },
});

// The Logs module receives and shows audit entries: it has no outbox and sends nothing out (BR-LOG-001). TT2 adds the
// analytics projection, which it also only receives.
// Sprint 6 TT1: ids of seeded rows removed from the projection; the upsert never writes them again. The purge function
// and grants are created in after-sync / migrations/1794528400000-Tt1AnalyticsTombstones.js.
export const AnalyticsTombstone = new EntitySchema({
  name: 'AnalyticsTombstone',
  tableName: 'analytics_tombstones',
  columns: {
    transactionId: { name: 'transaction_id', type: 'uuid', primary: true, primaryKeyConstraintName: 'analytics_tombstones_pkey' },
    removedAt: { name: 'removed_at', type: 'timestamptz', default: () => 'now()' },
  },
});

export const entities = [AuditLog, AnalyticsTransaction, AnalyticsBackfillState, AnalyticsTombstone];
