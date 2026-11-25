// S8-49: the main reason a request may finish late, in plain words (never the model's code or a score).
const REASONS = {
  TIME_SHARE_HIGH: 'Most of the promised time is already used.',
  TIME_SHARE_MEDIUM: 'About half of the promised time is already used.',
  TIME_SHARE_LOW: 'Only a small part of the promised time is used so far.',
  TIME_SHARE: 'Share of the promised time already used.',
  SERVICE_SIMPLE: 'A simple service that is usually finished quickly.',
  SERVICE_COMPLEX: 'A complex service that usually takes longer.',
  SERVICE_HIGHLY_TECHNICAL: 'A highly technical service that often runs late.',
  SERVICE_OFFICE_PACE: 'The office usually takes this long for this service.',
  OFFICE_WORKLOAD: 'The office has many open requests right now.',
  ON_HOLD: 'Paused (waiting for the client).',
  WORKING_WEEKDAY: 'It started on a busier working day.',
  MODEL_BASELINE: 'Based on how similar requests went before.',
  MAIN_REASON_UNAVAILABLE: 'The main reason is not available.',
};

/** Words for a reason code; an unknown code reads as unavailable and a code is never shown. */
export function mainReasonText(code) {
  return REASONS[code] ?? REASONS.MAIN_REASON_UNAVAILABLE;
}
