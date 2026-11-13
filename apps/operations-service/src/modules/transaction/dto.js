import { ROLES } from 'ccms-shared';

const iso = (value) => (value ? new Date(value).toISOString() : null);

/**
 * The transaction as the API returns it. Client email and reference belong to the detail only (`detail: true`):
 * the list never carries them.
 */
export function toTransactionDto(row, { detail = true } = {}) {
  const dto = {
    transaction_id: row.transaction_id,
    tracking_no: row.tracking_no,
    service_id: row.service_id,
    service_code: row.service_code,
    service_name: row.service_name,
    service_classification: row.service_classification,
    office_id: row.office_id,
    office_code: row.office_code,
    office_name: row.office_name ?? null,
    standard_id: row.standard_id,
    standard_duration_days: row.standard_duration_days,
    standard_duration_hours: row.standard_duration_hours,
    standard_duration_minutes: row.standard_duration_minutes,
    counter_id: row.counter_id ?? null,
    counter_label: row.counter_label ?? null,
    client_type: row.client_type,
    status: row.status,
    started_at: iso(row.started_at),
    started_by: row.started_by,
    started_by_name: row.started_by_name ?? null, // a copy taken at Start (CC046): a later rename of the account does not change it
    started_by_position: row.started_by_position ?? null,
    ended_at: iso(row.ended_at),
    ended_by: row.ended_by ?? null,
    elapsed_working_minutes: row.elapsed_working_minutes ?? null,
    is_compliant: row.is_compliant ?? null,
    variance_minutes: row.variance_minutes ?? null,
    is_backdated: row.is_backdated === true,
    started_outside_hours: row.started_outside_hours === true,
    outcome: row.outcome ?? null,
    held_minutes: row.held_minutes ?? 0,
    hold_started_at: iso(row.hold_started_at),
    receipt_email_status: row.receipt_email_status ?? 'NONE',
    // CC049: NONE when no acknowledgement email was queued (no client email, or an older transaction).
    acknowledgement_email_status: row.acknowledgement_email_status ?? 'NONE',
    // CC044: the status and reason code are flags; the student number and the private note are detail-only.
    registry_status: row.registry_status ?? 'NONE',
    registry_miss_reason: row.registry_miss_reason ?? null,
    // CC040: the linked queue ticket and the measured wait (null = started without a ticket; 0 is a measured zero).
    queue_ticket_id: row.queue_ticket_id ?? null,
    queue_ticket_no: row.queue_ticket_no ?? null,
    queue_wait_minutes: row.queue_wait_minutes ?? null,
    version: row.version,
  };
  if (detail) {
    dto.client_reference = row.client_reference ?? null;
    dto.client_email = row.client_email ?? null;
    dto.hold_reason = row.hold_reason ?? null;
    dto.cancel_reason = row.cancel_reason ?? null;
    dto.disapproval_reason = row.disapproval_reason ?? null;
    dto.disapproval_notice_given = row.disapproval_notice_given ?? null;
    dto.backdate_reason = row.backdate_reason ?? null;
    dto.receipt_email_attempts = row.receipt_email_attempts ?? 0;
    dto.registry_student_number = row.registry_student_number ?? null;
    dto.registry_miss_note = row.registry_miss_note ?? null;
  }
  return dto;
}

/**
 * CC027 / K14: the ONLY shape a transaction leaves Operations in for an Executive, for the list and the detail alike.
 * Built field by field from this allowlist (never the ordinary DTO with keys removed), so a column added later stays out
 * until someone adds it here on purpose. Anything not listed is absent from the JSON (not null): staff ids, names and
 * positions; the client's reference and email; registry status, student number, reason code and note; counter id and label;
 * every free-text reason (hold, cancel, disapproval, backdate); the disapproval notice flag; email statuses; ended_by.
 * What is left identifies the transaction and shows how the service was delivered (Sprint 5-8 spec 6.5): office, service,
 * classification, client type (a category, not an identity), status, outcome, timing, on time or late with the margin, flags.
 */
export const EXECUTIVE_TRANSACTION_FIELDS = Object.freeze([
  'transaction_id',
  'tracking_no',
  'service_id',
  'service_code',
  'service_name',
  'service_classification',
  'office_id',
  'office_code',
  'office_name',
  'standard_duration_days',
  'standard_duration_hours',
  'standard_duration_minutes',
  'client_type',
  'status',
  'outcome',
  'started_at',
  'ended_at',
  'hold_started_at',
  'held_minutes',
  'elapsed_working_minutes',
  'is_compliant',
  'variance_minutes',
  'is_backdated',
  'started_outside_hours',
  'version',
]);

export function toExecutiveTransactionDto(row) {
  return {
    transaction_id: row.transaction_id,
    tracking_no: row.tracking_no,
    service_id: row.service_id,
    service_code: row.service_code,
    service_name: row.service_name,
    service_classification: row.service_classification,
    office_id: row.office_id,
    office_code: row.office_code,
    office_name: row.office_name ?? null,
    standard_duration_days: row.standard_duration_days,
    standard_duration_hours: row.standard_duration_hours,
    standard_duration_minutes: row.standard_duration_minutes,
    client_type: row.client_type,
    status: row.status,
    // CC050: only a completed transaction carries a decision; the disapproval reason and notice flag never leave for an Executive.
    outcome: row.status === 'COMPLETED' ? (row.outcome ?? null) : null,
    started_at: iso(row.started_at),
    ended_at: iso(row.ended_at),
    hold_started_at: iso(row.hold_started_at),
    held_minutes: row.held_minutes ?? 0,
    elapsed_working_minutes: row.elapsed_working_minutes ?? null,
    is_compliant: row.is_compliant ?? null,
    variance_minutes: row.variance_minutes ?? null,
    is_backdated: row.is_backdated === true,
    started_outside_hours: row.started_outside_hours === true,
    version: row.version,
  };
}

/** The read view for this caller: the Executive allowlist, or the ordinary DTO (list or detail) for every other role. */
export function transactionDtoFor(user, row, { detail = true } = {}) {
  if (user?.role === ROLES.EXECUTIVE) return toExecutiveTransactionDto(row);
  return toTransactionDto(row, { detail });
}
