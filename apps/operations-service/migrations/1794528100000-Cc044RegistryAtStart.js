import { assertColumnsEmptyBeforeDrop, assertMigrationObjects } from 'ccms-shared';

// CC044 (spec 4.2, K5): what the Start recorded about the registry. Server-owned values only.
//   registry_student_number  the canonical CC043 student number (MATCHED, or EXPIRED when the record was found but expired)
//   registry_status          MATCHED | EXPIRED | NOT_FOUND | NONE. Existing rows, Employee/External and old rows stay NONE (TT2).
//   registry_miss_reason     a reason CODE, only with NOT_FOUND / EXPIRED (and then required)
//   registry_miss_note       the private note, 1-200 characters; required with OTHER. Never in audit or analytics payloads.
// Keep identical to the Transaction entity and to transactionRegistryRules() in src/lib/after-sync.js.
export const REGISTRY_CHECK_NAME = 'transactions_registry_ck';
export const REGISTRY_CHECK = [
  "registry_status IN ('MATCHED', 'EXPIRED', 'NOT_FOUND', 'NONE')",
  "(registry_miss_reason IS NULL OR registry_miss_reason IN ('OLDER_ALUMNI', 'NEW_ENROLLEE', 'RETURNING_STUDENT', 'NAME_DIFFERS', 'OTHER'))",
  "((registry_status IN ('NOT_FOUND', 'EXPIRED')) = (registry_miss_reason IS NOT NULL))",
  "(registry_status <> 'MATCHED' OR registry_student_number IS NOT NULL)",
  "(registry_status NOT IN ('NONE', 'NOT_FOUND') OR registry_student_number IS NULL)",
  "(registry_miss_note IS NULL OR (registry_miss_reason IS NOT NULL AND char_length(btrim(registry_miss_note)) BETWEEN 1 AND 200))",
  "(registry_miss_reason IS DISTINCT FROM 'OTHER' OR registry_miss_note IS NOT NULL)",
].join(' AND ');

const COLUMNS = {
  'column:transactions.registry_student_number': 'character varying(30)',
  'column:transactions.registry_status': "character varying(12) NOT NULL DEFAULT 'NONE'::character varying",
  'column:transactions.registry_miss_reason': 'character varying(20)',
  'column:transactions.registry_miss_note': 'character varying(200)',
};

export class Cc044RegistryAtStart1794528100000 {
  name = 'Cc044RegistryAtStart1794528100000';

  async up(runner) {
    await assertMigrationObjects(runner, COLUMNS);
    await runner.query(`ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS registry_student_number varchar(30),
      ADD COLUMN IF NOT EXISTS registry_status varchar(12) NOT NULL DEFAULT 'NONE',
      ADD COLUMN IF NOT EXISTS registry_miss_reason varchar(20),
      ADD COLUMN IF NOT EXISTS registry_miss_note varchar(200)`);
    const [{ present }] = await runner.query('SELECT count(*)::int AS present FROM pg_constraint WHERE conname = $1', [REGISTRY_CHECK_NAME]);
    if (!present) await runner.query(`ALTER TABLE transactions ADD CONSTRAINT ${REGISTRY_CHECK_NAME} CHECK (${REGISTRY_CHECK})`);
  }

  async down(runner) {
    // registry_status always has a value, so the guard looks at the columns that only Start fills.
    await assertColumnsEmptyBeforeDrop(runner, this.name, 'transactions', ['registry_student_number', 'registry_miss_reason', 'registry_miss_note']);
    await runner.query(`ALTER TABLE transactions DROP CONSTRAINT IF EXISTS ${REGISTRY_CHECK_NAME}`);
    await runner.query(`ALTER TABLE transactions DROP COLUMN IF EXISTS registry_miss_note, DROP COLUMN IF EXISTS registry_miss_reason,
      DROP COLUMN IF EXISTS registry_status, DROP COLUMN IF EXISTS registry_student_number`);
  }
}
