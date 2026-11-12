import { OutboxEvent, RateLimitHit } from 'ccms-shared';
import { EntitySchema } from 'typeorm';

// ---- Transaction (ERD section 4, with the Sprint 4 additions approved on 10/18, Decision G15) ----

// One row, id always 1 (a CHECK in after-sync). Created on first start with the defaults:
// hold off (B20), counters off (B22), auto-close off for every classification (B21).
export const TransactionSettings = new EntitySchema({
  name: 'TransactionSettings',
  tableName: 'transaction_settings',
  columns: {
    id: { type: 'smallint', primary: true },
    holdEnabled: { name: 'hold_enabled', type: 'boolean', default: false },
    countersEnabled: { name: 'counters_enabled', type: 'boolean', default: false },
    autoCloseDaysSimple: { name: 'auto_close_days_simple', type: 'int', nullable: true },
    autoCloseDaysComplex: { name: 'auto_close_days_complex', type: 'int', nullable: true },
    autoCloseDaysHighlyTechnical: { name: 'auto_close_days_highly_technical', type: 'int', nullable: true },
    version: { type: 'int', default: 1 },
    updatedAt: { name: 'updated_at', type: 'timestamptz', updateDate: true },
    updatedBy: { name: 'updated_by', type: 'uuid', nullable: true },
  },
});

// A service counter of one office. Never deleted, only deactivated. office_id is a plain ID (Core owns offices).
export const Counter = new EntitySchema({
  name: 'Counter',
  tableName: 'counters',
  columns: {
    counterId: { name: 'counter_id', type: 'uuid', primary: true },
    officeId: { name: 'office_id', type: 'uuid' },
    label: { type: 'varchar', length: 50 },
    isActive: { name: 'is_active', type: 'boolean', default: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
});

// One tracking-number sequence per office and Manila date. Updated in the same database transaction as the start.
export const TrackingSequence = new EntitySchema({
  name: 'TrackingSequence',
  tableName: 'tracking_sequences',
  columns: {
    officeId: { name: 'office_id', type: 'uuid', primary: true },
    seqDate: { name: 'seq_date', type: 'date', primary: true },
    lastSeq: { name: 'last_seq', type: 'int', default: 0 },
  },
});

// A citizen's transaction. The standard in force at the start, the service, the office and its classification are
// COPIED here (B4): later Charter changes never change a past result. Exactly two timestamps (started_at, ended_at, B1).
// Result columns stay empty until the compliance result is computed.
export const Transaction = new EntitySchema({
  name: 'Transaction',
  tableName: 'transactions',
  columns: {
    transactionId: { name: 'transaction_id', type: 'uuid', primary: true },
    trackingNo: { name: 'tracking_no', type: 'varchar', length: 60 },
    serviceId: { name: 'service_id', type: 'uuid' },
    serviceCode: { name: 'service_code', type: 'text' },
    serviceName: { name: 'service_name', type: 'text' },
    officeId: { name: 'office_id', type: 'uuid' },
    officeCode: { name: 'office_code', type: 'varchar', length: 20 },
    officeName: { name: 'office_name', type: 'text', nullable: true },
    serviceClassification: { name: 'service_classification', type: 'varchar', length: 20 },
    standardId: { name: 'standard_id', type: 'uuid' },
    standardDurationDays: { name: 'standard_duration_days', type: 'int' },
    standardDurationHours: { name: 'standard_duration_hours', type: 'int' },
    standardDurationMinutes: { name: 'standard_duration_minutes', type: 'int' },
    counterId: { name: 'counter_id', type: 'uuid', nullable: true },
    clientType: { name: 'client_type', type: 'varchar', length: 20 },
    clientReference: { name: 'client_reference', type: 'varchar', length: 100, nullable: true },
    clientEmail: { name: 'client_email', type: 'varchar', length: 254, nullable: true },
    startedAt: { name: 'started_at', type: 'timestamptz' },
    startedBy: { name: 'started_by', type: 'uuid' },
    endedAt: { name: 'ended_at', type: 'timestamptz', nullable: true },
    endedBy: { name: 'ended_by', type: 'uuid', nullable: true },
    status: { type: 'varchar', length: 20 },
    elapsedWorkingMinutes: { name: 'elapsed_working_minutes', type: 'int', nullable: true },
    isCompliant: { name: 'is_compliant', type: 'boolean', nullable: true },
    varianceMinutes: { name: 'variance_minutes', type: 'int', nullable: true },
    cancelReason: { name: 'cancel_reason', type: 'text', nullable: true },
    backdateReason: { name: 'backdate_reason', type: 'text', nullable: true },
    isBackdated: { name: 'is_backdated', type: 'boolean', default: false },
    heldMinutes: { name: 'held_minutes', type: 'int', default: 0 },
    holdReason: { name: 'hold_reason', type: 'text', nullable: true },
    holdStartedAt: { name: 'hold_started_at', type: 'timestamptz', nullable: true },
    // Ticketing is not part of Sprint 4 (QueueTicket is a stub in the ERD); the columns exist in the ERD and stay empty.
    queueTicketId: { name: 'queue_ticket_id', type: 'uuid', nullable: true },
    queueWaitMinutes: { name: 'queue_wait_minutes', type: 'int', nullable: true },
    receiptEmailStatus: { name: 'receipt_email_status', type: 'varchar', length: 10, default: 'NONE' },
    receiptEmailAttempts: { name: 'receipt_email_attempts', type: 'int', default: 0 },
    receiptEmailClaimToken: { name: 'receipt_email_claim_token', type: 'uuid', nullable: true },
    receiptEmailClaimUntil: { name: 'receipt_email_claim_until', type: 'timestamptz', nullable: true },
    // CC046: the starter's position at the time of Start (a copy; empty when unknown).
    startedByPosition: { name: 'started_by_position', type: 'varchar', length: 100, nullable: true },
    // CC051: confirmed Start outside working time (server-set).
    startedOutsideHours: { name: 'started_outside_hours', type: 'boolean', default: false },
    // CC046: the starter's display name at the time of Start (a copy, like the office name; empty when unknown or an old row).
    startedByName: { name: 'started_by_name', type: 'varchar', length: 200, nullable: true },
    // CC050: how it ended. Both stay empty on old rows ("Not recorded").
    outcome: { type: 'varchar', length: 12, nullable: true },
    disapprovalReason: { name: 'disapproval_reason', type: 'text', nullable: true },
    disapprovalNoticeGiven: { name: 'disapproval_notice_given', type: 'boolean', nullable: true },
    // CC044: registry capture at Start (server-owned). NONE for old rows, Employee/External and seeded rows without a lookup.
    // The CHECK (transactions_registry_ck) lives in after-sync and migrations/1794528100000-Cc044RegistryAtStart.js.
    registryStudentNumber: { name: 'registry_student_number', type: 'varchar', length: 30, nullable: true },
    registryStatus: { name: 'registry_status', type: 'varchar', length: 12, default: 'NONE' },
    registryMissReason: { name: 'registry_miss_reason', type: 'varchar', length: 20, nullable: true },
    registryMissNote: { name: 'registry_miss_note', type: 'varchar', length: 200, nullable: true },
    version: { type: 'int', default: 1 },
    // TT2: analytics feed counter (not the optimistic lock). 0 = never emitted; each analytics event increments it.
    analyticsEventVersion: { name: 'analytics_event_version', type: 'int', default: 0 },
  },
});

// ---- TT2 analytics outbox (logical consumer ANALYTICS) ----
// One row per emitted analytics snapshot, written in the same database transaction as the business change and later
// delivered to Oversight. Separate from audit_outbox: the two destinations never share delivery state. The unique
// (transaction_id, event_version), the CHECK and the pending index are created in after-sync / the TT2 migration.
export const AnalyticsOutboxEvent = new EntitySchema({
  name: 'AnalyticsOutboxEvent',
  tableName: 'analytics_outbox',
  columns: {
    eventId: { name: 'event_id', type: 'uuid', primary: true, primaryKeyConstraintName: 'analytics_outbox_pkey' },
    transactionId: { name: 'transaction_id', type: 'uuid' },
    eventVersion: { name: 'event_version', type: 'int' },
    eventType: { name: 'event_type', type: 'varchar', length: 40 },
    payload: { type: 'jsonb' },
    createdAt: { name: 'created_at', type: 'timestamptz', default: () => 'now()' },
    attempts: { type: 'int', default: 0 },
    nextAttemptAt: { name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' },
    leaseToken: { name: 'lease_token', type: 'uuid', nullable: true },
    leaseUntil: { name: 'lease_until', type: 'timestamptz', nullable: true },
    deliveredAt: { name: 'delivered_at', type: 'timestamptz', nullable: true },
    lastError: { name: 'last_error', type: 'varchar', length: 500, nullable: true },
  },
});

// ---- CC038 Forecast runs (Sprint 6) ----
// One row per completed or attempted forecast run. Never updated; retrain inserts a new row.
// Indexes and constraints created in after-sync via migrateSprint6Operations.
export const ForecastRun = new EntitySchema({
  name: 'ForecastRun',
  tableName: 'forecast_runs',
  columns: {
    id:                       { type: 'uuid', primary: true, primaryKeyConstraintName: 'forecast_runs_pkey', default: () => 'gen_random_uuid()' },
    officeId:                 { name: 'office_id', type: 'uuid' },
    serviceId:                { name: 'service_id', type: 'uuid', nullable: true },
    selectedModel:            { name: 'selected_model', type: 'varchar', length: 30 },
    mae:                      { type: 'numeric', precision: 10, scale: 4, nullable: true },
    historyStartDate:         { name: 'history_start_date', type: 'date', nullable: true },
    historyEndDate:           { name: 'history_end_date', type: 'date', nullable: true },
    historyWorkingDays:       { name: 'history_working_days', type: 'int', nullable: true },
    historicalTransactionCount: { name: 'historical_transaction_count', type: 'int', nullable: true },
    forecastPayload:          { name: 'forecast_payload', type: 'jsonb', default: () => "'[]'" },
    weeklyTotal:              { name: 'weekly_total', type: 'int', default: 0 },
    status:                   { type: 'varchar', length: 20, default: 'SUCCESS' },
    errorCode:                { name: 'error_code', type: 'varchar', length: 50, nullable: true },
    errorMessage:             { name: 'error_message', type: 'text', nullable: true },
    generatedAt:              { name: 'generated_at', type: 'timestamptz', createDate: true },
    createdAt:                { name: 'created_at', type: 'timestamptz', createDate: true },
  },
});

export const RegistryImport = new EntitySchema({
  name: 'RegistryImport',
  tableName: 'registry_imports',
  columns: {
    importId: { name: 'import_id', type: 'uuid', primary: true, primaryKeyConstraintName: 'registry_imports_pkey' },
    rows: { type: 'int' },
    added: { type: 'int' },
    updated: { type: 'int' },
    unchanged: { type: 'int' },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  checks: [{
    name: 'registry_imports_counts_check',
    expression: 'rows > 0 AND added >= 0 AND updated >= 0 AND unchanged >= 0 AND rows = added + updated + unchanged',
  }],
});

export const RegistryPerson = new EntitySchema({
  name: 'RegistryPerson',
  tableName: 'registry_people',
  columns: {
    studentNumber: { name: 'student_number', type: 'varchar', length: 30, primary: true, primaryKeyConstraintName: 'registry_people_pkey' },
    fullName: { name: 'full_name', type: 'varchar', length: 200 },
    program: { type: 'varchar', length: 20 },
    yearLevel: { name: 'year_level', type: 'smallint', nullable: true },
    status: { type: 'varchar', length: 8 },
    validUntil: { name: 'valid_until', type: 'date', nullable: true },
    email: { type: 'varchar', length: 254, nullable: true },
    lastImportId: { name: 'last_import_id', type: 'uuid' },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
    updatedAt: { name: 'updated_at', type: 'timestamptz', updateDate: true },
  },
  foreignKeys: [{
    name: 'registry_people_last_import_id_fkey',
    target: 'RegistryImport',
    columnNames: ['lastImportId'],
    referencedColumnNames: ['importId'],
  }],
  checks: [
    { name: 'registry_people_program_check', expression: "program ~ '^[A-Z0-9-]{2,20}$'" },
    {
      name: 'registry_people_status_check',
      expression: "(status = 'ENROLLED' AND valid_until IS NOT NULL AND year_level IS NOT NULL AND year_level BETWEEN 1 AND 6) OR (status = 'ALUMNI' AND year_level IS NULL)",
    },
  ],
});

// ---- CC049 client emails other than the completion receipt (kind ACKNOWLEDGEMENT) ----
// Constraints, the FK and the due index are created in after-sync / migrations/1794528200000-Cc049TransactionEmails.js.
export const TransactionEmail = new EntitySchema({
  name: 'TransactionEmail',
  tableName: 'transaction_emails',
  columns: {
    emailId: { name: 'email_id', type: 'uuid', primary: true, primaryKeyConstraintName: 'transaction_emails_pkey' },
    transactionId: { name: 'transaction_id', type: 'uuid' },
    kind: { type: 'varchar', length: 20 },
    status: { type: 'varchar', length: 10, default: 'PENDING' },
    attempts: { type: 'int', default: 0 },
    idempotencyKey: { name: 'idempotency_key', type: 'varchar', length: 100 },
    claimToken: { name: 'claim_token', type: 'uuid', nullable: true },
    claimUntil: { name: 'claim_until', type: 'timestamptz', nullable: true },
    firstAttemptAt: { name: 'first_attempt_at', type: 'timestamptz', nullable: true },
    nextAttemptAt: { name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' },
    providerMessageId: { name: 'provider_message_id', type: 'varchar', length: 200, nullable: true },
    lastErrorCode: { name: 'last_error_code', type: 'varchar', length: 60, nullable: true },
    sentAt: { name: 'sent_at', type: 'timestamptz', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', default: () => 'now()' },
    updatedAt: { name: 'updated_at', type: 'timestamptz', default: () => 'now()' },
  },
});

// ---- Sprint 6 TT1 provenance of the historical-records import (demo only) ----
// Constraints and indexes in after-sync / migrations/1794528300000-Tt1SeedProvenance.js.
export const SeedRun = new EntitySchema({
  name: 'SeedRun',
  tableName: 'seed_runs',
  columns: {
    runId: { name: 'run_id', type: 'uuid', primary: true, primaryKeyConstraintName: 'seed_runs_pkey' },
    mode: { type: 'varchar', length: 10 },
    algorithmVersion: { name: 'algorithm_version', type: 'varchar', length: 40 },
    randomSeed: { name: 'random_seed', type: 'varchar', length: 100, nullable: true },
    periodFrom: { name: 'period_from', type: 'date', nullable: true },
    periodTo: { name: 'period_to', type: 'date', nullable: true },
    asOf: { name: 'as_of', type: 'date', nullable: true },
    operatorId: { name: 'operator_id', type: 'uuid' },
    inputsDigest: { name: 'inputs_digest', type: 'varchar', length: 64, nullable: true },
    counts: { type: 'jsonb', default: () => "'{}'::jsonb" },
    createdAt: { name: 'created_at', type: 'timestamptz', default: () => 'now()' },
  },
});

export const SeededTransaction = new EntitySchema({
  name: 'SeededTransaction',
  tableName: 'seeded_transactions',
  columns: {
    transactionId: { name: 'transaction_id', type: 'uuid', primary: true, primaryKeyConstraintName: 'seeded_transactions_pkey' },
    runId: { name: 'run_id', type: 'uuid' },
    trackingNo: { name: 'tracking_no', type: 'varchar', length: 60 },
    removedAt: { name: 'removed_at', type: 'timestamptz', nullable: true },
    removedByRun: { name: 'removed_by_run', type: 'uuid', nullable: true },
    oversightPurgedAt: { name: 'oversight_purged_at', type: 'timestamptz', nullable: true },
  },
});

export const LateRiskRun = new EntitySchema({
  name: 'LateRiskRun', tableName: 'late_risk_runs',
  columns: {
    runId: { name: 'run_id', type: 'uuid', primary: true, primaryKeyConstraintName: 'late_risk_runs_pkey', default: () => 'gen_random_uuid()' },
    createdAt: { name: 'created_at', type: 'timestamptz', default: () => 'now()' },
    status: { type: 'varchar', length: 24 },
    rows: { type: 'int' },
    trainingRows: { name: 'training_rows', type: 'int' },
    holdoutRows: { name: 'holdout_rows', type: 'int' },
    lateCases: { name: 'late_cases', type: 'int' },
    excludedRows: { name: 'excluded_rows', type: 'int' },
    metrics: { type: 'jsonb', nullable: true },
    coefficients: { type: 'jsonb', nullable: true },
  },
  indices: [{ name: 'late_risk_runs_created_idx', columns: ['createdAt', 'runId'] }],
});

export const LateRiskScoreCache = new EntitySchema({
  name: 'LateRiskScoreCache', tableName: 'late_risk_score_cache',
  columns: {
    officeId: { name: 'office_id', type: 'uuid', primary: true, primaryKeyConstraintName: 'late_risk_score_cache_pkey' },
    scoredAt: { name: 'scored_at', type: 'timestamptz' },
    runId: { name: 'run_id', type: 'uuid', nullable: true },
    payload: { type: 'jsonb' },
  },
});

export const entities = [TransactionSettings, Counter, TrackingSequence, Transaction, OutboxEvent, RateLimitHit, ForecastRun,
  AnalyticsOutboxEvent, RegistryImport, RegistryPerson, TransactionEmail, SeedRun, SeededTransaction, LateRiskRun, LateRiskScoreCache];
