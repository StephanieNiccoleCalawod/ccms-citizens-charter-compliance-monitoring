// Shared values of the Transaction module.
export const STATUS = Object.freeze({
  IN_PROGRESS: 'IN_PROGRESS',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  AUTO_CLOSED: 'AUTO_CLOSED',
});
export const STATUS_LIST = Object.freeze(Object.values(STATUS));
export const OPEN_STATUSES = Object.freeze([STATUS.IN_PROGRESS, STATUS.ON_HOLD]);

export const CLIENT_TYPES = Object.freeze(['STUDENT', 'ALUMNI', 'EMPLOYEE', 'EXTERNAL']);
export const CLASSIFICATIONS = Object.freeze(['SIMPLE', 'COMPLEX', 'HIGHLY_TECHNICAL']);

export const REASON_MAX = 500;

// CC050
export const OUTCOMES = Object.freeze(['GRANTED', 'DISAPPROVED']);
export const DISAPPROVAL_REASON_MAX = 1000;

/** The actor recorded for work done by a job rather than a person (Decision G15). */
export const SYSTEM_ACTOR = Object.freeze({ actorUserId: null, actorRole: 'system' });

export const MSG = Object.freeze({
  CHOOSE_SERVICE: 'Choose a service',
  CLIENT_TYPE: 'Client type is required',
  EMAIL: 'Enter a valid email address',
  REQUIREMENTS: 'Confirm that all required documents are present before starting',
  COUNTER: 'Choose your counter',
  OPEN_EXISTS: 'You already have an open transaction. Complete or hand it over first.',
  COUNTER_BUSY: 'This counter already has an open transaction',
  NO_STANDARD_TODAY: 'No standard is in force for this service today',
  CATALOGUE_DOWN: 'The service catalogue is unavailable. Try again, or record a past transaction when the service is available.',
  CALENDAR_DOWN: 'Cannot reach the calendar right now. The transaction remains paused (waiting for the client). Try again.',
  HOLD_OFF: 'Pausing transactions is turned off for this institution. Ask the Super Admin for assistance.',
  HOLD_REASON: 'Enter a reason for pausing the transaction while waiting for the client',
  NOT_IN_PROGRESS: 'This transaction is not in progress',
  NOT_ON_HOLD: 'This transaction is not paused (waiting for the client). Refresh the transaction to check its current status.',
  RESUME_FIRST: 'Resume the transaction before completing it',
  CANCEL_REASON: 'Enter a reason for cancelling',
  CANCEL_STATE: 'Only open transactions can be cancelled',
  BACKDATE_REASON: 'Enter the reason for recording a past transaction (up to 500 characters)',
  FUTURE: 'Time cannot be in the future',
  END_AFTER_START: 'End must be after start',
  CALENDAR_START_DOWN: 'The calendar is unavailable. Try again, or record a past transaction when the calendar is available.',
  OUTSIDE_HOURS: 'It is outside working hours. The time count starts at the next opening. Start anyway?',
  OUTCOME: 'Choose Granted or Disapproved',
  DISAPPROVAL_REASON: 'Enter the reason for disapproval (up to 1,000 characters)',
  DISAPPROVAL_NOTICE: 'Confirm that the client was given written notice of the disapproval',
});
