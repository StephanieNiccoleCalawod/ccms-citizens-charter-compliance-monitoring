import { assertTablesEmptyBeforeDrop } from 'ccms-shared';

// CC057 (spec 9.2; C-10, K24): a citizen rates the service once, with the one-time code from the completion receipt.
//
//   One row per completed transaction, made in the same database transaction that completes it (the code is issued then).
//   rating_code  12 characters from an alphabet without look-alikes (no 0/O, 1/I/L); unique; shown on the receipt and to staff
//   stars        1 to 5, empty until the code is used; rated_at is set with it and never changes (a code rates once)
//   office / service ids and the service's code and name are copied so the summary needs no join and survives a rename
// No free text, no name, no address, no user id and no IP address is kept: the rating is not linked to a person.
// Keep identical to the ServiceRating entity and ratingRules() in src/lib/after-sync.js.
const TABLE_SQL = `
  CREATE TABLE service_ratings (
    rating_id uuid NOT NULL,
    transaction_id uuid NOT NULL,
    rating_code character varying(12) NOT NULL,
    office_id uuid NOT NULL,
    service_id uuid NOT NULL,
    service_code text NOT NULL,
    service_name text NOT NULL,
    issued_at timestamptz NOT NULL DEFAULT now(),
    stars smallint,
    rated_at timestamptz,
    CONSTRAINT service_ratings_pkey PRIMARY KEY (rating_id)
  );`;

export const RATING_CONSTRAINTS = [
  ['service_ratings_transaction_fk', 'FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id)'],
  ['service_ratings_transaction_uq', 'UNIQUE (transaction_id)'],
  ['service_ratings_code_uq', 'UNIQUE (rating_code)'],
  ['service_ratings_values_ck', "CHECK ((stars IS NULL) = (rated_at IS NULL) AND (stars IS NULL OR stars BETWEEN 1 AND 5) AND rating_code ~ '^[A-HJ-KM-NP-Z2-9]{12}$')"],
];
export const RATING_INDEXES = [
  'CREATE INDEX IF NOT EXISTS service_ratings_office_rated_idx ON service_ratings (office_id, rated_at) WHERE stars IS NOT NULL',
];

export class Cc057ServiceRatings1795000100000 {
  name = 'Cc057ServiceRatings1795000100000';

  async up(runner) {
    const [{ present }] = await runner.query("SELECT to_regclass('public.service_ratings') IS NOT NULL AS present");
    if (present) throw new Error('service_ratings already exists outside the migration history. Review it and write a fix-up migration.');
    await runner.query(TABLE_SQL);
    for (const [name, definition] of RATING_CONSTRAINTS) await runner.query(`ALTER TABLE service_ratings ADD CONSTRAINT ${name} ${definition}`);
    for (const sql of RATING_INDEXES) await runner.query(sql);
  }

  // Ratings are the offices' feedback: refused while any exist unless CCMS_ALLOW_DATA_LOSS names this migration (after a backup).
  async down(runner) {
    await assertTablesEmptyBeforeDrop(runner, this.name, ['service_ratings']);
    await runner.query('DROP TABLE IF EXISTS service_ratings');
  }
}
