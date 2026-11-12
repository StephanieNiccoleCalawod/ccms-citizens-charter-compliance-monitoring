import { getMailer } from '../lib/mailer.js';
import { getDb } from '../lib/data-source.js';
import { getIdempotentMailTransport } from '../lib/idempotent-mail.js';
import { runReceiptJob } from '../modules/transaction/receipt.js';
import { runAcknowledgementJob } from '../modules/transaction/acknowledgement.js';

/** One run of receipt-emails (CC024): sends or retries the waiting receipts. */
export async function runReceiptEmails(overrides = {}) {
  return runReceiptJob({ dataSource: await getDb(), mailer: getMailer(), ...overrides });
}

/** CC049: one run of the acknowledgement emails, through the idempotent transport only (never SMTP). */
export async function runAcknowledgementEmails(overrides = {}) {
  return runAcknowledgementJob({ dataSource: await getDb(), transport: getIdempotentMailTransport(), ...overrides });
}

/**
 * The cron entry point: receipts and acknowledgements have independent state, so one failing never stops the other.
 * Returns { receipts, acknowledgements }, each the job summary or { error } with a short message.
 */
export async function runClientEmails() {
  const settle = async (job) => {
    try {
      return await job();
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', message: 'Client email job failed', error: err?.message }));
      return { error: 'job failed' };
    }
  };
  return { receipts: await settle(() => runReceiptEmails()), acknowledgements: await settle(() => runAcknowledgementEmails()) };
}
