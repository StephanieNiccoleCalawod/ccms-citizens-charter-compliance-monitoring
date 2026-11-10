import { readFileSync } from 'node:fs';
import { assertEmptyForBaseline, refuseBaselineRevert } from 'ccms-shared';

// Baseline: the Identity schema as it stood before Sprint 5 (commit 64ca621: entities + after-sync.js), captured with
// pg_dump --schema-only from a database built by that code. See docs/database-migrations.md.
//   Empty database     migrate:run executes this file and creates everything.
//   Existing database  migrate:baseline only records this migration as applied; it never runs up().
const SQL = readFileSync(new URL('./sql/1793491200000-IdentityBaseline.up.sql', import.meta.url), 'utf8');
export const BASELINE_TABLES = ['accounts', 'audit_outbox', 'password_reset_tokens', 'rate_limit_hits', 'refresh_tokens'];

export class IdentityBaseline1793491200000 {
  name = 'IdentityBaseline1793491200000';

  async up(queryRunner) {
    await assertEmptyForBaseline(queryRunner, BASELINE_TABLES, this.name);
    await queryRunner.query(SQL);
  }

  async down() {
    refuseBaselineRevert(this.name);
  }
}
