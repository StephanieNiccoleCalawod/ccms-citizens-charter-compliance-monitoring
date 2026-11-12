// TT2 numbered migrations on disposable loopback databases only: apply once, show as applied, rerun without change,
// guarded revert, upgrade of existing rows, and refusal of incompatible pre-existing objects.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { schemaFingerprint } from 'ccms-shared';
import { DEFAULT_TEST_PG_URL } from 'ccms-shared/testing';

const ADMIN_URL = process.env.TEST_PG_URL ?? DEFAULT_TEST_PG_URL;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(ADMIN_URL).hostname)) {
  throw new Error('TT2 migration tests require a loopback disposable PostgreSQL server; hosted URLs are refused.');
}
const created = [];
after(async () => {
  for (const name of created) await q(ADMIN_URL, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
});

async function q(url, sql, params) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}
async function emptyDatabase(prefix) {
  const name = `ccms_tt2_${prefix}_${randomBytes(4).toString('hex')}`;
  await q(ADMIN_URL, `CREATE DATABASE ${name}`);
  created.push(name);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
}
function cli(service, url, args, extraEnv = {}) {
  const env = { ...process.env, DATABASE_URL: url, DATABASE_ADMIN_URL: '', DB_TARGET: '', CCMS_ALLOW_DATA_LOSS: '', ...extraEnv };
  const cwd = fileURLToPath(new URL(`../apps/${service}-service/`, import.meta.url));
  const result = spawnSync(process.execPath, ['scripts/migrate.js', ...args], { cwd, env, encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}
const fingerprint = (url) => q(url, 'SELECT 1').then(async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await schemaFingerprint({ query: async (sql, params) => (await client.query(sql, params)).rows });
  } finally {
    await client.end();
  }
});
const OPS = 'Tt2AnalyticsOutbox1794355200000';
const OVS = 'Tt2AnalyticsTransactions1794355300000';
function revertAfterOperationsTt2(url) {
  for (const migration of ['Tt1SeedProvenance1794528300000', 'Cc049TransactionEmails1794528200000', 'Cc044RegistryAtStart1794528100000', 'Cc043Registry1794441600000']) {
    const reverted = cli('operations', url, ['revert']);
    assert.equal(reverted.code, 0, reverted.out);
    assert.ok(reverted.out.includes(`Reverted: ${migration}`), reverted.out);
  }
}
const TX = (id, version = 0) => `INSERT INTO transactions (transaction_id, tracking_no, service_id, service_code, service_name, office_id, office_code, service_classification,
  standard_id, standard_duration_days, standard_duration_hours, standard_duration_minutes, client_type, started_at, started_by, status${version === null ? '' : ', analytics_event_version'})
  VALUES ('${id}', 'PUP-REG-20261001-000${id.slice(-1)}', '00000000-0000-4000-8000-0000000000aa', 'C', 'S', '00000000-0000-4000-8000-0000000000bb', 'PUP-REG', 'SIMPLE',
  '00000000-0000-4000-8000-0000000000cc', 0, 1, 0, 'STUDENT', now(), '00000000-0000-4000-8000-00000000000${id.slice(-1)}', 'COMPLETED'${version === null ? '' : `, ${version}`})`;

describe('Operations TT2 migration', () => {
  test('applies once, shows as applied, reruns without change; existing rows start at version 0 and keep their data', async () => {
    const url = await emptyDatabase('ops');
    assert.equal(cli('operations', url, ['run']).code, 0);
    revertAfterOperationsTt2(url);
    assert.match(cli('operations', url, ['revert']).out, new RegExp(`Reverted: ${OPS}`));
    // A database at the previous migration with existing records.
    await q(url, TX('00000000-0000-4000-8000-000000000001', null));
    const before = await q(url, 'SELECT * FROM transactions');
    const run = cli('operations', url, ['run']);
    assert.equal(run.code, 0, run.out);
    assert.match(run.out, new RegExp(`Applied: ${OPS}`));
    const after = await q(url, 'SELECT * FROM transactions');
    assert.equal(after[0].analytics_event_version, 0);
    const unchanged = Object.fromEntries(Object.keys(before[0]).map((key) => [key, after[0][key]]));
    assert.deepEqual(unchanged, before[0], 'no existing value changed');
    const show = cli('operations', url, ['show']);
    assert.match(show.out, new RegExp(`\\[X\\] ${OPS}`));
    assert.match(show.out, /Up to date\./);
    const schema = await fingerprint(url);
    const rerun = cli('operations', url, ['run']);
    assert.match(rerun.out, /No pending migrations/);
    assert.deepEqual(await fingerprint(url), schema);
  });

  test('revert is refused while it would lose events or versions, unless explicitly allowed', async () => {
    const url = await emptyDatabase('ops_loss');
    assert.equal(cli('operations', url, ['run']).code, 0);
    revertAfterOperationsTt2(url);
    await q(url, TX('00000000-0000-4000-8000-000000000002', 1));
    let refused = cli('operations', url, ['revert']);
    assert.equal(refused.code, 1);
    assert.match(refused.out, /would delete analytics versions in 1 row/);
    await q(url, `INSERT INTO analytics_outbox (event_id, transaction_id, event_version, event_type, payload)
                  VALUES ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000002', 1, 'TRANSACTION_STARTED', '{}')`);
    refused = cli('operations', url, ['revert']);
    assert.equal(refused.code, 1);
    assert.match(refused.out, /would delete 1 row\(s\) from analytics_outbox/);
    assert.equal((await q(url, 'SELECT count(*)::int AS n FROM analytics_outbox'))[0].n, 1);
    const allowed = cli('operations', url, ['revert'], { CCMS_ALLOW_DATA_LOSS: OPS });
    assert.equal(allowed.code, 0, allowed.out);
    assert.deepEqual(await q(url, "SELECT to_regclass('analytics_outbox') AS t"), [{ t: null }]);
    assert.equal(cli('operations', url, ['run']).code, 0, 'can be applied again');
  });

  test('an incompatible pre-existing column or a partial table is refused without repair', async () => {
    const url = await emptyDatabase('ops_bad');
    assert.equal(cli('operations', url, ['run']).code, 0);
    revertAfterOperationsTt2(url);
    assert.equal(cli('operations', url, ['revert']).code, 0);
    await q(url, 'ALTER TABLE transactions ADD COLUMN analytics_event_version bigint');
    let before = await fingerprint(url);
    let run = cli('operations', url, ['run']);
    assert.equal(run.code, 1);
    assert.match(run.out, /Incompatible existing migration objects/);
    assert.deepEqual(await fingerprint(url), before);
    await q(url, 'ALTER TABLE transactions DROP COLUMN analytics_event_version; CREATE TABLE analytics_outbox (event_id uuid)');
    before = await fingerprint(url);
    run = cli('operations', url, ['run']);
    assert.equal(run.code, 1);
    assert.deepEqual(await fingerprint(url), before);
  });
});

describe('Oversight TT2 migration', () => {
  test('applies with exact grants, reruns without change, guards revert and leaves audit_log untouched', async () => {
    const url = await emptyDatabase('ovs');
    assert.equal(cli('oversight', url, ['run']).code, 0);
    assert.match(cli('oversight', url, ['revert']).out, /Reverted: Tt1AnalyticsTombstones1794528400000/);
    assert.match(cli('oversight', url, ['revert']).out, new RegExp(`Reverted: ${OVS}`));
    const auditOnly = await fingerprint(url);
    const run = cli('oversight', url, ['run']);
    assert.match(run.out, new RegExp(`Applied: ${OVS}`));
    const schema = await fingerprint(url);
    for (const [key, value] of Object.entries(auditOnly)) assert.equal(schema[key], value, `audit object changed: ${key}`);
    assert.deepEqual(Object.keys(schema).filter((k) => /^grant:analytics_(backfill_state|transactions)\./.test(k)).sort(), [
      'grant:analytics_backfill_state.ccms_logs_writer.INSERT', 'grant:analytics_backfill_state.ccms_logs_writer.SELECT', 'grant:analytics_backfill_state.ccms_logs_writer.UPDATE',
      'grant:analytics_transactions.ccms_logs_writer.INSERT', 'grant:analytics_transactions.ccms_logs_writer.SELECT', 'grant:analytics_transactions.ccms_logs_writer.UPDATE',
      'grant:analytics_transactions.ccms_oversight_app.SELECT',
    ]);
    assert.match(cli('oversight', url, ['run']).out, /No pending migrations/);
    assert.deepEqual(await fingerprint(url), schema);

    assert.match(cli('oversight', url, ['revert']).out, /Reverted: Tt1AnalyticsTombstones1794528400000/);
    await q(url, "INSERT INTO analytics_backfill_state (job_name) VALUES ('analytics-backfill')");
    const refused = cli('oversight', url, ['revert']);
    assert.equal(refused.code, 1);
    assert.match(refused.out, /would delete 1 row\(s\) from analytics_backfill_state/);
    assert.equal(cli('oversight', url, ['revert'], { CCMS_ALLOW_DATA_LOSS: OVS }).code, 0);
    assert.deepEqual(await fingerprint(url), auditOnly);
    const baselineRevert = cli('oversight', url, ['revert']);
    assert.equal(baselineRevert.code, 1);
    assert.match(baselineRevert.out, /cannot be reverted/);
  });
});
