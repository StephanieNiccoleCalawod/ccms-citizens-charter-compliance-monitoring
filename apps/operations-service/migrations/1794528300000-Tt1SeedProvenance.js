import { assertTablesEmptyBeforeDrop } from 'ccms-shared';

// Sprint 6 TT1 (seeded history v2, demo only): persistent provenance of the historical-records import.
//   seed_runs             one row per successful write run (IMPORT or REMOVE): who, period, as-of date, random seed,
//                         algorithm version, input digest and aggregate counts. Never deleted.
//   seeded_transactions   one row per transaction an import created. It is the ONLY ownership proof the removal accepts:
//                         a row in the reserved 9001-9999 range that is not listed here is an ambiguity and stops the run.
//                         Removal keeps the row (removed_at) so the Oversight purge can be retried safely after a partial
//                         failure (oversight_purged_at). No FK to transactions, because the transaction row is deleted.
// Keep identical to the SeedRun / SeededTransaction entities.
export const SEED_PROVENANCE_SQL = `
  CREATE TABLE seed_runs (
    run_id uuid NOT NULL,
    mode varchar(10) NOT NULL,
    algorithm_version varchar(40) NOT NULL,
    random_seed varchar(100),
    period_from date,
    period_to date,
    as_of date,
    operator_id uuid NOT NULL,
    inputs_digest varchar(64),
    counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT seed_runs_pkey PRIMARY KEY (run_id),
    CONSTRAINT seed_runs_mode_ck CHECK (mode IN ('IMPORT', 'REMOVE'))
  );
  CREATE TABLE seeded_transactions (
    transaction_id uuid NOT NULL,
    run_id uuid NOT NULL,
    tracking_no varchar(60) NOT NULL,
    removed_at timestamptz,
    removed_by_run uuid,
    oversight_purged_at timestamptz,
    CONSTRAINT seeded_transactions_pkey PRIMARY KEY (transaction_id),
    CONSTRAINT seeded_transactions_run_fk FOREIGN KEY (run_id) REFERENCES seed_runs (run_id),
    CONSTRAINT seeded_transactions_removed_run_fk FOREIGN KEY (removed_by_run) REFERENCES seed_runs (run_id),
    CONSTRAINT seeded_transactions_removal_ck CHECK ((removed_at IS NULL) = (removed_by_run IS NULL) AND (oversight_purged_at IS NULL OR removed_at IS NOT NULL))
  );
  CREATE INDEX seeded_transactions_run_idx ON seeded_transactions (run_id);
  CREATE INDEX seeded_transactions_open_idx ON seeded_transactions (transaction_id) WHERE removed_at IS NULL OR oversight_purged_at IS NULL;
`;

export class Tt1SeedProvenance1794528300000 {
  name = 'Tt1SeedProvenance1794528300000';

  async up(runner) {
    const [{ present }] = await runner.query(
      "SELECT (to_regclass('public.seed_runs') IS NOT NULL OR to_regclass('public.seeded_transactions') IS NOT NULL) AS present",
    );
    if (present) throw new Error('Seed provenance tables already exist outside the migration history. Review them and write a fix-up migration.');
    await runner.query(SEED_PROVENANCE_SQL);
  }

  async down(runner) {
    // Provenance is what makes a later removal safe. Remove the seeded history first; then a backup and
    // CCMS_ALLOW_DATA_LOSS=<this migration> are still required to drop the record.
    await assertTablesEmptyBeforeDrop(runner, this.name, ['seeded_transactions', 'seed_runs']);
    await runner.query('DROP TABLE IF EXISTS seeded_transactions; DROP TABLE IF EXISTS seed_runs;');
  }
}
