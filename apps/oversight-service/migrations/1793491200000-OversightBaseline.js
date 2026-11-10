import { readFileSync } from 'node:fs';
import { assertEmptyForBaseline, refuseBaselineRevert } from 'ccms-shared';
import { auditLogGrants } from '../src/lib/after-sync.js';

// Baseline: the Oversight (Logs) schema as it stood before Sprint 5 (commit 64ca621: entities, after-sync.js and the
// Sprint 4 critical migration), captured with pg_dump --schema-only --no-privileges from a database built by that code.
//   Empty database     migrate:run executes this file: the table, then the two runtime roles and the grants
//                      (Sprint 4 TT2), exactly as db:sync provisions them.
//   Existing database  migrate:baseline only records this migration as applied; it never runs up().
// Run as the schema owner (DATABASE_ADMIN_URL), never as ccms_logs_writer.
const SQL = readFileSync(new URL('./sql/1793491200000-OversightBaseline.up.sql', import.meta.url), 'utf8');
export const BASELINE_TABLES = ['audit_log'];

export class OversightBaseline1793491200000 {
  name = 'OversightBaseline1793491200000';

  async up(queryRunner) {
    await assertEmptyForBaseline(queryRunner, BASELINE_TABLES, this.name);
    await queryRunner.query(SQL);
    // Roles are cluster-wide; the same lock as db:sync keeps two provisioning runs from racing on them.
    await queryRunner.query('SELECT pg_advisory_xact_lock(43436, 2)');
    await auditLogGrants(queryRunner);
  }

  async down() {
    refuseBaselineRevert(this.name);
  }
}
