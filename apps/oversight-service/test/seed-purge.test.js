// Sprint 6 TT1: removing seeded rows from the analytics projection; tombstones stop any replay. CC044 KPI counts.
// Authored for Codex; not run by the author.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createDataSource, setDataSource } from 'ccms-shared';
import { POST as purgeRoute } from '../src/app/api/internal/analytics-purge/route.js';
import { entities } from '../src/lib/entities/index.js';
import { computeKpis } from '../src/modules/analytics/kpi.js';
import { applyAnalyticsSnapshots } from '../src/modules/analytics/store.js';
import { SERVICE_KEY, call, req, roleUrl, setupTestEnv } from './helpers.js';

let env;
let writer;
before(async () => {
  env = await setupTestEnv();
  writer = createDataSource({ url: roleUrl(env.url, 'ccms_logs_writer'), entities, synchronize: false });
  await writer.initialize();
});
after(async () => {
  delete process.env.ANALYTICS_SEED_PURGE;
  await writer?.destroy();
  await env?.teardown();
});
beforeEach(async () => {
  await env.ds.query('DELETE FROM analytics_transactions');
  await env.ds.query('DELETE FROM analytics_tombstones');
  setDataSource(writer); // the route runs as the runtime role, like the deployed service
  process.env.ANALYTICS_SEED_PURGE = 'enabled';
});

const snapshot = (over = {}) => ({
  transaction_id: randomUUID(), tracking_no: 'PUP-REG-20261015-9001', office_id: randomUUID(), service_id: randomUUID(),
  service_code: 'PUP-REG-TOR-001', classification: 'COMPLEX', client_type: 'STUDENT', standard_days: 3, standard_hours: 0,
  standard_minutes: 0, started_at: '2026-10-15T02:00:00.000Z', ended_at: null, status: 'IN_PROGRESS', elapsed_working_minutes: null,
  is_compliant: null, variance_minutes: null, held_minutes: 0, is_backdated: false, started_outside_hours: false,
  registry_status: 'NONE', registry_miss_reason: null, outcome: null, started_by_user_id: randomUUID(), ended_by_user_id: null,
  counter_id: null, event_version: 1, ...over,
});
const purge = (items) => call(purgeRoute, req('POST', '/internal/analytics-purge', { key: SERVICE_KEY, body: { items } }));
const count = async () => (await env.ds.query('SELECT count(*)::int AS n FROM analytics_transactions'))[0].n;

describe('POST /api/internal/analytics-purge', () => {
  it('removes seeded rows, tombstones them, and a replayed or backfilled event never restores them', async () => {
    const seeded = snapshot();
    await applyAnalyticsSnapshots(writer, [seeded]);
    const r = await purge([{ transaction_id: seeded.transaction_id, tracking_no: seeded.tracking_no }]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { purged: 1, tombstoned: 1 });
    assert.equal(await count(), 0);
    assert.deepEqual(await applyAnalyticsSnapshots(writer, [{ ...seeded, event_version: 7 }]), { applied: 0, ignored: 1 });
    assert.equal(await count(), 0);
    assert.deepEqual((await purge([{ transaction_id: seeded.transaction_id, tracking_no: seeded.tracking_no }])).body, { purged: 0, tombstoned: 0 });
  });

  it('refuses live rows and non-seeded tracking numbers, changing nothing', async () => {
    const liveRow = snapshot({ tracking_no: 'PUP-REG-20261015-0001' });
    await applyAnalyticsSnapshots(writer, [liveRow]);
    assert.equal((await purge([{ transaction_id: liveRow.transaction_id, tracking_no: liveRow.tracking_no }])).status, 400);
    // A seeded-looking tracking number cannot be used to delete a live row either (the function checks is_seeded).
    const forged = await purge([{ transaction_id: liveRow.transaction_id, tracking_no: 'PUP-REG-20261015-9002' }]);
    assert.equal(forged.status, 409);
    assert.equal(await count(), 1);
    assert.equal((await env.ds.query('SELECT count(*)::int AS n FROM analytics_tombstones'))[0].n, 0);
  });

  // Codex finding (TT1 AC5): an ingest/backfill write overlapping a purge must never leave the row restored.
  describe('overlap with a concurrent write (both orderings)', () => {
    const waiting = async () => {
      for (let i = 0; i < 100; i += 1) {
        const [{ n }] = await env.ds.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");
        if (n > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('the second connection never waited for the lock');
    };
    const state = async (id) => ({
      rows: (await env.ds.query('SELECT count(*)::int AS n FROM analytics_transactions WHERE transaction_id = $1', [id]))[0].n,
      tombstones: (await env.ds.query('SELECT count(*)::int AS n FROM analytics_tombstones WHERE transaction_id = $1', [id]))[0].n,
    });

    it('purge first: a write that waited behind the open purge is ignored after the purge commits', async () => {
      const seeded = snapshot();
      await applyAnalyticsSnapshots(writer, [seeded]);
      const purger = writer.createQueryRunner();
      await purger.connect();
      try {
        await purger.startTransaction();
        await purger.query('SELECT * FROM purge_seeded_analytics($1::uuid[])', [[seeded.transaction_id]]);
        const write = applyAnalyticsSnapshots(writer, [{ ...seeded, event_version: 9 }]);
        await waiting();
        await purger.commitTransaction();
        assert.deepEqual(await write, { applied: 0, ignored: 1 });
      } finally {
        if (purger.isTransactionActive) await purger.rollbackTransaction();
        await purger.release();
      }
      assert.deepEqual(await state(seeded.transaction_id), { rows: 0, tombstones: 1 });
    });

    it('write first: a purge that waited behind the open write removes the row after the write commits', async () => {
      const seeded = snapshot();
      const ingester = writer.createQueryRunner();
      await ingester.connect();
      try {
        await ingester.startTransaction();
        await applyAnalyticsSnapshots(ingester.manager, [seeded]);
        const removal = purge([{ transaction_id: seeded.transaction_id, tracking_no: seeded.tracking_no }]);
        await waiting();
        await ingester.commitTransaction();
        const r = await removal;
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual(r.body, { purged: 1, tombstoned: 1 });
      } finally {
        if (ingester.isTransactionActive) await ingester.rollbackTransaction();
        await ingester.release();
      }
      assert.deepEqual(await state(seeded.transaction_id), { rows: 0, tombstones: 1 });
      assert.deepEqual(await applyAnalyticsSnapshots(writer, [{ ...seeded, event_version: 12 }]), { applied: 0, ignored: 1 });
    });

    it('live (not seeded) batches never wait for the purge lock', async () => {
      const seeded = snapshot();
      await applyAnalyticsSnapshots(writer, [seeded]);
      const purger = writer.createQueryRunner();
      await purger.connect();
      try {
        await purger.startTransaction();
        await purger.query('SELECT * FROM purge_seeded_analytics($1::uuid[])', [[seeded.transaction_id]]);
        const liveRow = snapshot({ tracking_no: 'PUP-REG-20261015-0002' });
        assert.deepEqual(await applyAnalyticsSnapshots(writer, [liveRow]), { applied: 1, ignored: 0 });
        await purger.commitTransaction();
      } finally {
        if (purger.isTransactionActive) await purger.rollbackTransaction();
        await purger.release();
      }
    });
  });

  it('needs the service key and is off unless ANALYTICS_SEED_PURGE=enabled', async () => {
    assert.equal((await call(purgeRoute, req('POST', '/internal/analytics-purge', { body: { items: [] } }))).status, 401);
    process.env.ANALYTICS_SEED_PURGE = '';
    assert.equal((await purge([])).status, 403);
  });

  it('the runtime role cannot delete projection rows directly', async () => {
    await assert.rejects(writer.query('DELETE FROM analytics_transactions'), /permission denied/);
  });
});

describe('CC044 "not in registry" KPI counts', () => {
  it('counts NOT_FOUND and EXPIRED, per reason code', () => {
    const base = { started_at: '2026-10-15T02:00:00Z', office_id: 'o', service_id: 's' };
    const rows = [
      { ...base, registry_status: 'NOT_FOUND', registry_miss_reason: 'NEW_ENROLLEE' },
      { ...base, registry_status: 'EXPIRED', registry_miss_reason: 'RETURNING_STUDENT' },
      { ...base, registry_status: 'MATCHED', registry_miss_reason: null },
    ];
    const { totals } = computeKpis(rows, { from: '2026-10-01', to: '2026-10-31' });
    assert.equal(totals.not_in_registry, 2);
    assert.equal(totals.not_in_registry_by_reason.NEW_ENROLLEE, 1);
    assert.equal(totals.not_in_registry_by_reason.RETURNING_STUDENT, 1);
  });
});
