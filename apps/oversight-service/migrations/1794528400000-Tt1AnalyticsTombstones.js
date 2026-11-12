import { assertTablesEmptyBeforeDrop } from 'ccms-shared';

// Sprint 6 TT1 (seeded history v2, demo only): removing seeded rows from the analytics projection without letting a late
// or replayed analytics event bring them back.
//   analytics_tombstones        one row per removed transaction_id. The ingest/backfill upsert skips tombstoned ids.
//   purge_seeded_analytics()    SECURITY DEFINER, owned by the schema owner: tombstones the given ids and deletes their
//                               projection rows, but ONLY rows marked is_seeded (tracking number 9001-9999, K16). If any
//                               given id belongs to a live (not seeded) row, nothing at all changes.
// Concurrency (Codex finding, TT1 AC5): an upsert that started before a purge committed could wait on the purge's row
// lock and then insert the row again, because its tombstone check used a snapshot taken before the purge committed.
// Both sides now take the advisory lock SEED_PURGE_LOCK first: the purge exclusively, any upsert batch that contains a
// seeded row in shared mode. The tombstone check and the delete run in statements AFTER the lock is held, so each sees
// what the other committed, in either order. Batches of live (non-seeded) rows never take the lock.
// Runtime access stays narrow: ccms_logs_writer gets SELECT on the tombstones and EXECUTE on the function, never DELETE on
// analytics_transactions. Keep identical to tombstoneRules()/analyticsGrants() in src/lib/after-sync.js.
export const SEED_PURGE_LOCK = Object.freeze([43436, 910]);

export const TOMBSTONES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS analytics_tombstones (
  transaction_id uuid NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_tombstones_pkey PRIMARY KEY (transaction_id)
)`;

export const PURGE_FUNCTION_SQL = `CREATE OR REPLACE FUNCTION purge_seeded_analytics(ids uuid[])
RETURNS TABLE (purged integer, tombstoned integer, refused integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  n_refused integer;
  n_purged integer;
  n_tombstoned integer;
BEGIN
  IF ids IS NULL OR cardinality(ids) > 500 OR array_position(ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'purge_seeded_analytics takes 0 to 500 non-null ids';
  END IF;
  -- Serializes with every upsert batch holding seeded rows (store.js takes the same lock in shared mode). Held to commit.
  PERFORM pg_advisory_xact_lock(43436, 910);
  SELECT count(*)::integer INTO n_refused FROM analytics_transactions a WHERE a.transaction_id = ANY (ids) AND a.is_seeded = false;
  IF n_refused > 0 THEN
    RETURN QUERY SELECT 0, 0, n_refused;
    RETURN;
  END IF;
  INSERT INTO analytics_tombstones (transaction_id) SELECT DISTINCT u FROM unnest(ids) AS u ON CONFLICT (transaction_id) DO NOTHING;
  GET DIAGNOSTICS n_tombstoned = ROW_COUNT;
  DELETE FROM analytics_transactions a WHERE a.transaction_id = ANY (ids) AND a.is_seeded = true;
  GET DIAGNOSTICS n_purged = ROW_COUNT;
  RETURN QUERY SELECT n_purged, n_tombstoned, 0;
END
$fn$`;

export const PURGE_GRANTS_SQL = [
  'REVOKE ALL ON FUNCTION purge_seeded_analytics(uuid[]) FROM PUBLIC',
  'GRANT EXECUTE ON FUNCTION purge_seeded_analytics(uuid[]) TO ccms_logs_writer',
  'GRANT SELECT ON analytics_tombstones TO ccms_logs_writer',
];

export class Tt1AnalyticsTombstones1794528400000 {
  name = 'Tt1AnalyticsTombstones1794528400000';

  async up(runner) {
    const [{ present }] = await runner.query("SELECT to_regclass('public.analytics_tombstones') IS NOT NULL AS present");
    if (present) throw new Error('analytics_tombstones already exists outside the migration history. Review it and write a fix-up migration.');
    await runner.query(TOMBSTONES_TABLE_SQL);
    await runner.query(PURGE_FUNCTION_SQL);
    for (const sql of PURGE_GRANTS_SQL) await runner.query(sql);
  }

  async down(runner) {
    // Dropping the tombstones would let a replay restore removed seeded rows: back up first and allow it explicitly.
    await assertTablesEmptyBeforeDrop(runner, this.name, ['analytics_tombstones']);
    await runner.query('DROP FUNCTION IF EXISTS purge_seeded_analytics(uuid[])');
    await runner.query('DROP TABLE IF EXISTS analytics_tombstones');
  }
}
