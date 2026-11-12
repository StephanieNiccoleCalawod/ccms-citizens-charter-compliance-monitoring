import { assertMigrationObjects } from 'ccms-shared';

// CC047 (spec 8.1, K6): services.allowed_client_types, a non-empty array of STUDENT, ALUMNI, EMPLOYEE and EXTERNAL.
// Every existing service is backfilled to all four (the column default), so nothing changes for a Start until the
// Super Admin narrows a service. The CHECK refuses an empty array, a NULL element, an unknown value and a
// multi-dimensional array, whatever writes the row. Duplicates and order are normalised by the application.
//
// Keep the definitions identical to the Service entity (src/lib/entities/index.js) so db:sync and migrate:run build the
// same schema.
export const ALLOWED_CLIENT_TYPES_DEFAULT = "ARRAY['STUDENT'::text, 'ALUMNI'::text, 'EMPLOYEE'::text, 'EXTERNAL'::text]";
export const ALLOWED_CLIENT_TYPES_CHECK =
  "cardinality(allowed_client_types) >= 1 AND array_ndims(allowed_client_types) = 1 " +
  "AND array_position(allowed_client_types, NULL::text) IS NULL " +
  "AND allowed_client_types <@ ARRAY['STUDENT'::text, 'ALUMNI'::text, 'EMPLOYEE'::text, 'EXTERNAL'::text]";

export class Cc047AllowedClientTypes1794528000000 {
  name = 'Cc047AllowedClientTypes1794528000000';

  async up(runner) {
    // Refuse to "repair" a column or constraint of the same name that someone created by hand with another definition.
    await assertMigrationObjects(runner, {
      'column:services.allowed_client_types': `text[] NOT NULL DEFAULT ${ALLOWED_CLIENT_TYPES_DEFAULT}`,
    });
    await runner.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS allowed_client_types text[] NOT NULL DEFAULT ${ALLOWED_CLIENT_TYPES_DEFAULT}`);
    const [{ present }] = await runner.query("SELECT count(*)::int AS present FROM pg_constraint WHERE conname = 'services_allowed_client_types_check'");
    if (!present) {
      await runner.query(`ALTER TABLE services ADD CONSTRAINT services_allowed_client_types_check CHECK (${ALLOWED_CLIENT_TYPES_CHECK})`);
    }
  }

  // Rollback never silently discards configured eligibility. If any service is narrowed to fewer than all four types,
  // the revert stops: export the configuration first (the query is printed), take a backup, and only then run it with
  // CCMS_ALLOW_DATA_LOSS=Cc047AllowedClientTypes1794528000000. Reverting an un-narrowed catalogue loses nothing.
  async down(runner) {
    const [{ narrowed }] = await runner.query(
      `SELECT count(*)::int AS narrowed FROM services
        WHERE NOT (allowed_client_types @> ARRAY['STUDENT'::text, 'ALUMNI'::text, 'EMPLOYEE'::text, 'EXTERNAL'::text])`,
    );
    const allowed = (process.env.CCMS_ALLOW_DATA_LOSS ?? '').split(',').map((value) => value.trim()).includes(this.name);
    if (narrowed && !allowed) {
      throw new Error(
        `Reverting ${this.name} would discard the client-type restriction of ${narrowed} service(s). Export it first with ` +
          "SELECT service_code, allowed_client_types FROM services WHERE cardinality(allowed_client_types) < 4, take a " +
          `backup, then set CCMS_ALLOW_DATA_LOSS=${this.name} to proceed.`,
      );
    }
    await runner.query('ALTER TABLE services DROP CONSTRAINT IF EXISTS services_allowed_client_types_check');
    await runner.query('ALTER TABLE services DROP COLUMN IF EXISTS allowed_client_types');
  }
}
