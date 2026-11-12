import { assertTablesEmptyBeforeDrop } from 'ccms-shared';

// CC049 (spec 6.3, K25): one row per (transaction, kind) of a client email with its own delivery state, independent of the
// completion receipt (which keeps its columns on transactions). Kind ACKNOWLEDGEMENT is queued in the Start's own database
// transaction when the final receipt email exists. The address is never copied here: the sender reads it from the
// transaction. idempotency_key is stable for the row's life and is sent with every attempt (provider-side dedupe).
// Keep identical to the TransactionEmail entity and transactionEmailRules() in src/lib/after-sync.js.
export const TRANSACTION_EMAILS_SQL = `
  CREATE TABLE transaction_emails (
    email_id uuid NOT NULL,
    transaction_id uuid NOT NULL,
    kind varchar(20) NOT NULL,
    status varchar(10) NOT NULL DEFAULT 'PENDING',
    attempts integer NOT NULL DEFAULT 0,
    idempotency_key varchar(100) NOT NULL,
    claim_token uuid,
    claim_until timestamptz,
    first_attempt_at timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    provider_message_id varchar(200),
    last_error_code varchar(60),
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT transaction_emails_pkey PRIMARY KEY (email_id),
    CONSTRAINT transaction_emails_transaction_fk FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id),
    CONSTRAINT transaction_emails_kind_uq UNIQUE (transaction_id, kind),
    CONSTRAINT transaction_emails_key_uq UNIQUE (idempotency_key),
    CONSTRAINT transaction_emails_values_ck CHECK (kind IN ('ACKNOWLEDGEMENT') AND status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')
      AND attempts >= 0 AND (status <> 'SENT' OR sent_at IS NOT NULL) AND ((status = 'SENDING') = (claim_token IS NOT NULL)))
  );
  CREATE INDEX transaction_emails_due_idx ON transaction_emails (next_attempt_at, created_at) WHERE status IN ('PENDING', 'SENDING', 'FAILED');
`;

export class Cc049TransactionEmails1794528200000 {
  name = 'Cc049TransactionEmails1794528200000';

  async up(runner) {
    const [{ present }] = await runner.query("SELECT to_regclass('public.transaction_emails') IS NOT NULL AS present");
    if (present) throw new Error('transaction_emails already exists outside the migration history. Review it and write a fix-up migration.');
    await runner.query(TRANSACTION_EMAILS_SQL);
  }

  async down(runner) {
    // Queued or sent acknowledgements are delivery records: a backup and CCMS_ALLOW_DATA_LOSS=<this migration> first.
    await assertTablesEmptyBeforeDrop(runner, this.name, ['transaction_emails']);
    await runner.query('DROP TABLE IF EXISTS transaction_emails');
  }
}
