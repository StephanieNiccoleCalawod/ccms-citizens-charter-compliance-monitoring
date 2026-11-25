// CC049 (spec 6.3, K25; RA 11032 Sec. 9(a)): what the printable acknowledgement slip shows, as a pure function.
// Everything comes from the saved transaction: the officer's name and position are the copies taken at Start (CC046),
// never the account's current details.
import { formatDateTime } from './date-format.js';
import { officeName } from './names.js';
import { starterLabels } from './account-position.js';

export const ACK_QUOTE_LINE = 'Quote this tracking number for any follow-up or complaint';

export function acknowledgementSlip(tx) {
  const starter = starterLabels(tx);
  return {
    trackingNo: tx.tracking_no,
    office: officeName(tx),
    service: tx.service_name,
    officerName: starter.name,
    officerPosition: starter.position,
    receivedAt: `${formatDateTime(tx.started_at) || '-'} (Philippine time)`,
    quoteLine: ACK_QUOTE_LINE,
  };
}

/**
 * TT3: what to tell the staff member about the acknowledgement email. The slip is always the proof, so a mail that is waiting or has
 * failed never blocks anything; the screen says so in plain words. null when there is nothing to say (no email or already sent).
 */
export function ackEmailNotice(tx) {
  const status = tx?.acknowledgement_email_status;
  if (status === 'PENDING' || status === 'SENDING') return { tone: 'info', text: 'The acknowledgement email has not been sent yet. It will be sent automatically. You can print the slip now.' };
  if (status === 'FAILED') return { tone: 'warning', text: 'The acknowledgement email could not be sent. The system will try again. Please print the slip for the client.' };
  return null;
}
