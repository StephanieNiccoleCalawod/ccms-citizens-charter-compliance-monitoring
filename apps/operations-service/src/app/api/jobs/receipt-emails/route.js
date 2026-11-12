import { cronRoute } from 'ccms-shared';
import { runClientEmails } from '../../../../jobs/receipt-emails.js';

export const dynamic = 'force-dynamic';

// Vercel Cron calls this (see vercel.json) with "Authorization: Bearer $CRON_SECRET".
// It sends the receipt emails that are PENDING and retries the FAILED ones (fewer than 5 attempts), and (CC049) sends or
// retries the queued acknowledgement emails through the idempotent transport. Each kind has its own state.
export const GET = cronRoute('receipt-emails', () => runClientEmails());
