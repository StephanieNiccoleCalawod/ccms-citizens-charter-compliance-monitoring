import { cronRoute } from 'ccms-shared';
import { runAcknowledgementEmails } from '../../../../jobs/receipt-emails.js';

export const dynamic = 'force-dynamic';

export const GET = cronRoute('acknowledgement-emails', () => runAcknowledgementEmails());
