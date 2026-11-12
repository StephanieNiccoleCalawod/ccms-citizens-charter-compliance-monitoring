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
