import { assertMigrationObjects } from 'ccms-shared';

// CC040: the link from a transaction to the queue ticket it served. The columns transactions.queue_ticket_id and
// transactions.queue_wait_minutes are in the baseline (nullable, never filled before CC040); this adds only the rules:
//   transactions_queue_ticket_fk   the id points at a real ticket
//   transactions_queue_ticket_uq   one transaction per ticket (a ticket is linked once), NULL = started without a ticket
//   transactions_queue_wait_ck     a measured wait is never negative (0 is a measured zero; NULL = not measured)
// Needs Cc039QueueTickets1794900000000 first. Keep identical to transactionQueueRules() in src/lib/after-sync.js.
export const QUEUE_LINK_CONSTRAINTS = [
  ['transactions_queue_ticket_fk', 'FOREIGN KEY (queue_ticket_id) REFERENCES queue_tickets (ticket_id)'],
  ['transactions_queue_wait_ck', 'CHECK (queue_wait_minutes IS NULL OR (queue_ticket_id IS NOT NULL AND queue_wait_minutes >= 0))'],
];
export const QUEUE_LINK_INDEX =
  'CREATE UNIQUE INDEX IF NOT EXISTS transactions_queue_ticket_uq ON transactions (queue_ticket_id) WHERE queue_ticket_id IS NOT NULL';

const EXPECTED = {
  'constraint:transactions.transactions_queue_ticket_fk': 'FOREIGN KEY (queue_ticket_id) REFERENCES queue_tickets(ticket_id)',
  'constraint:transactions.transactions_queue_wait_ck': 'CHECK (((queue_wait_minutes IS NULL) OR ((queue_ticket_id IS NOT NULL) AND (queue_wait_minutes >= 0))))',
  'index:transactions.transactions_queue_ticket_uq':
    'CREATE UNIQUE INDEX transactions_queue_ticket_uq ON public.transactions USING btree (queue_ticket_id) WHERE (queue_ticket_id IS NOT NULL)',
};

export class Cc040QueueTicketLink1794900100000 {
  name = 'Cc040QueueTicketLink1794900100000';

  async up(runner) {
    await assertMigrationObjects(runner, EXPECTED);
    // Before CC040 nothing wrote these columns; a value here was put in by hand and must be reviewed first.
    const [{ filled }] = await runner.query('SELECT count(*)::int AS filled FROM transactions WHERE queue_ticket_id IS NOT NULL OR queue_wait_minutes IS NOT NULL');
    if (filled) throw new Error(`${filled} transaction(s) already carry a queue ticket or wait. Review them before applying ${this.name}.`);
    for (const [name, definition] of QUEUE_LINK_CONSTRAINTS) {
      const [{ present }] = await runner.query('SELECT count(*)::int AS present FROM pg_constraint WHERE conname = $1', [name]);
      if (!present) await runner.query(`ALTER TABLE transactions ADD CONSTRAINT ${name} ${definition}`);
    }
    await runner.query(QUEUE_LINK_INDEX);
  }

  // Dropping only rules: the columns and every recorded link and wait stay.
  async down(runner) {
    await runner.query('DROP INDEX IF EXISTS transactions_queue_ticket_uq');
    for (const [name] of [...QUEUE_LINK_CONSTRAINTS].reverse()) await runner.query(`ALTER TABLE transactions DROP CONSTRAINT IF EXISTS ${name}`);
  }
}
