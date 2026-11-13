import { assertTablesEmptyBeforeDrop } from 'ccms-shared';

// CC039 (spec 9.1, K7, K29): the minimum queue. One daily ticket sequence per office and Manila date, and one row per ticket.
//
//   queue_sequences  (office_id, queue_date) -> last_seq (the display number, 1, 2, 3 ... from 001 each Manila day) and
//                    last_order (the position counter of both lanes; a Skip takes the next value to move a ticket to its tail).
//                    Every issuance and every Skip of an office/day updates this one row, so they serialise on its row lock.
//   queue_tickets    the ticket. issued_at is the original issue instant and never changes (CC040 measures from it). Only the
//                    priority LANE is stored (never which of senior citizen / PWD / pregnant the person said, never a name).
//                    WAITING -> CALLED (Call next) -> SERVED (linked at Start, CC040); CALLED -> WAITING again on Skip after the
//                    grace period, with a new queue_order (the tail of its lane) and the same number, issued_at and lane.
//
// Keep identical to the QueueSequence / QueueTicket entities and queueRules() in src/lib/after-sync.js.
export const QUEUE_TICKETS_CHECK = [
  'seq >= 1', 'queue_order >= 1', 'call_count >= 0', 'skip_count >= 0', 'version >= 1',
  "lane IN ('REGULAR', 'PRIORITY')",
  "issued_via IN ('PUBLIC', 'STAFF')",
  "status IN ('WAITING', 'CALLED', 'SERVED')",
  "((issued_via = 'STAFF') = (issued_by IS NOT NULL))",
  "(status <> 'CALLED' OR called_at IS NOT NULL)",
  "((status = 'SERVED') = (transaction_id IS NOT NULL AND served_at IS NOT NULL))",
].join(' AND ');

export const QUEUE_CONSTRAINTS = [
  ['queue_sequences', 'queue_sequences_values_ck', 'CHECK (last_seq >= 0 AND last_order >= 0)'],
  ['queue_tickets', 'queue_tickets_number_uq', 'UNIQUE (office_id, queue_date, seq)'],
  ['queue_tickets', 'queue_tickets_order_uq', 'UNIQUE (office_id, queue_date, queue_order)'],
  ['queue_tickets', 'queue_tickets_transaction_uq', 'UNIQUE (transaction_id)'],
  ['queue_tickets', 'queue_tickets_values_ck', `CHECK (${QUEUE_TICKETS_CHECK})`],
];

export const QUEUE_INDEXES = [
  "CREATE INDEX IF NOT EXISTS queue_tickets_waiting_idx ON queue_tickets (office_id, queue_date, lane, queue_order) WHERE status = 'WAITING'",
  'CREATE INDEX IF NOT EXISTS queue_tickets_board_idx ON queue_tickets (office_id, queue_date, status)',
];

const TABLES_SQL = `
  CREATE TABLE queue_sequences (
    office_id uuid NOT NULL,
    queue_date date NOT NULL,
    last_seq integer NOT NULL DEFAULT 0,
    last_order integer NOT NULL DEFAULT 0,
    CONSTRAINT queue_sequences_pkey PRIMARY KEY (office_id, queue_date)
  );
  CREATE TABLE queue_tickets (
    ticket_id uuid NOT NULL,
    office_id uuid NOT NULL,
    office_code character varying(20) NOT NULL,
    queue_date date NOT NULL,
    seq integer NOT NULL,
    ticket_no character varying(40) NOT NULL,
    lane character varying(8) NOT NULL,
    status character varying(10) NOT NULL DEFAULT 'WAITING',
    queue_order integer NOT NULL,
    issued_at timestamptz NOT NULL,
    issued_via character varying(6) NOT NULL,
    issued_by uuid,
    called_at timestamptz,
    called_by uuid,
    call_count integer NOT NULL DEFAULT 0,
    skip_count integer NOT NULL DEFAULT 0,
    last_skipped_at timestamptz,
    served_at timestamptz,
    transaction_id uuid,
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT queue_tickets_pkey PRIMARY KEY (ticket_id)
  );`;

export class Cc039QueueTickets1794900000000 {
  name = 'Cc039QueueTickets1794900000000';

  async up(runner) {
    const [{ present }] = await runner.query(
      "SELECT (to_regclass('public.queue_tickets') IS NOT NULL OR to_regclass('public.queue_sequences') IS NOT NULL) AS present",
    );
    if (present) throw new Error('queue_tickets or queue_sequences already exists outside the migration history. Review it and write a fix-up migration.');
    await runner.query(TABLES_SQL);
    for (const [table, name, definition] of QUEUE_CONSTRAINTS) await runner.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
    for (const sql of QUEUE_INDEXES) await runner.query(sql);
  }

  async down(runner) {
    // Issued tickets are operational records (and CC040 links point at them): a backup and CCMS_ALLOW_DATA_LOSS=<this migration> first.
    await assertTablesEmptyBeforeDrop(runner, this.name, ['queue_tickets']);
    await runner.query('DROP TABLE IF EXISTS queue_tickets');
    await runner.query('DROP TABLE IF EXISTS queue_sequences');
  }
}
