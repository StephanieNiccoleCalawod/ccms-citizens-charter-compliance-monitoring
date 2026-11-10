// Read-only: prints the schema fingerprint (tables, columns, constraints, indexes, triggers, functions, extensions and
// non-owner grants of the public schema) of the database in DATABASE_URL as JSON. It never writes and never prints
// the connection string. Used to (re)generate a service's migrations/baseline-schema.json from a verified database
// and to compare an isolated copy of the hosted schema with the baseline.
//   DATABASE_URL=postgres://... node scripts/db-schema-fingerprint.mjs > fingerprint.json
import pg from 'pg';
import { schemaFingerprint } from 'ccms-shared';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not configured');
const ssl = /[?&]sslmode=(require|verify-full|verify-ca)/.test(url) ? { rejectUnauthorized: true } : undefined;
const client = new pg.Client({ connectionString: url, ssl });
await client.connect();
try {
  // Read-only session: any accidental write fails.
  await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  const fingerprint = await schemaFingerprint({ query: async (sql, params) => (await client.query(sql, params)).rows });
  process.stdout.write(`${JSON.stringify(fingerprint, null, 2)}\n`);
} finally {
  await client.end();
}
