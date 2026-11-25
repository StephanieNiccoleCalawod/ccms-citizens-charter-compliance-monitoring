import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { calculation } from 'ccms-shared';
import { listOperationsNotifications } from '../src/modules/notifications/notifications.js';
import { OFFICE_A, OFFICE_B, USERS, head, setupTestEnv, staff } from './helpers.js';

// S8-42 gap checks through the real late-risk read (cached scores in the test database), not a fake feed:
//  - recipients: Office Staff get notices only for their own transactions, the Office Head for the whole office
//  - another office's notices never appear for an office user
//  - re-polling gives the same notice keys (the bell can not show a duplicate)
//  - a person never receives staff names, client details or probabilities in a notice
let env;
before(async () => { env = await setupTestEnv(); });
after(async () => env?.teardown());
beforeEach(async () => { await env.ds.query('DELETE FROM late_risk_score_cache'); });

const NOW = new Date('2026-10-20T03:00:00Z');
const row = (startedBy, over = {}) => ({ transaction_id: randomUUID(), tracking_no: `TRK-${Math.floor(Math.random() * 1e6)}`, service_name: 'TOR Request', level: 'LOW',
  working_minutes_left: 0, share_used: 1, started_by: startedBy, probability: 0.93, staff_name: 'Secret Staff Name', ...over });

async function seedCache(officeId, items) {
  // A cache entry needs calculation metadata and reason codes to qualify as fresh.
  const reasonCodes = { LOW: 'TIME_SHARE_LOW', HIGH: 'TIME_SHARE_HIGH' };
  const payload = {
    model: { method: 'rule-based' },
    items: items.map((item) => ({ ...item, main_reason_code: reasonCodes[item.level] })),
    calculations: {
      late_risk: calculation({
        shows: 'Late-risk scores for open requests.',
        steps: ['Apply the allowed working-time share rule.'],
        count: items.length, basis: 'Open requests', source: 'transactions',
        method: 'allowed-time-share rule', at: NOW,
      }),
    },
  };
  await env.ds.query(`INSERT INTO late_risk_score_cache (office_id, scored_at, run_id, payload) VALUES ($1,$2,NULL,$3::jsonb)
    ON CONFLICT (office_id) DO UPDATE SET scored_at = EXCLUDED.scored_at, run_id = NULL, payload = EXCLUDED.payload`,
  [officeId, NOW, JSON.stringify(payload)]);
}

describe('S8-42 recipients', () => {
  it('Office Staff get only their own transactions; the Office Head gets the office; another staff member gets only theirs', async () => {
    const mine = row(USERS.staffA); const theirs = row(USERS.staffA2); const alsoMine = row(USERS.staffA, { working_minutes_left: 10, share_used: 0.9 });
    await seedCache(OFFICE_A, [mine, theirs, alsoMine]);
    const ids = async (user) => (await listOperationsNotifications(env.ds, user, { now: NOW })).items.map((n) => n.transaction_id).sort();
    assert.deepEqual(await ids(staff(USERS.staffA)), [mine.transaction_id, alsoMine.transaction_id].sort());
    assert.deepEqual(await ids(staff(USERS.staffA2)), [theirs.transaction_id]);
    assert.deepEqual(await ids(head(USERS.headA)), [mine.transaction_id, theirs.transaction_id, alsoMine.transaction_id].sort());
  });

  it('an office user never receives another office\'s notices, by default or by asking for it', async () => {
    await seedCache(OFFICE_B, [row(USERS.staffA)]);
    assert.deepEqual((await listOperationsNotifications(env.ds, head(USERS.headA), { now: NOW })).items, []);
    await assert.rejects(listOperationsNotifications(env.ds, head(USERS.headA), { officeId: OFFICE_B, now: NOW }), { status: 403 });
    await assert.rejects(listOperationsNotifications(env.ds, staff(USERS.staffA), { officeId: OFFICE_B, now: NOW }), { status: 403 });
  });
});

describe('S8-42 re-polling and content', () => {
  it('polling again returns the same keys, one notice per transaction and kind', async () => {
    await seedCache(OFFICE_A, [row(USERS.staffA), row(USERS.staffA, { working_minutes_left: 20, share_used: 0.85, level: 'HIGH' })]);
    const first = (await listOperationsNotifications(env.ds, head(USERS.headA), { now: NOW })).items.map((n) => n.key);
    const second = (await listOperationsNotifications(env.ds, head(USERS.headA), { now: new Date(NOW.getTime() + 30_000) })).items.map((n) => n.key);
    assert.equal(first.length, 3);
    assert.deepEqual(second, first);
    assert.equal(new Set(first).size, first.length);
  });

  it('a notice carries no staff name, probability or started_by, and links to the transaction', async () => {
    await seedCache(OFFICE_A, [row(USERS.staffA)]);
    const { items } = await listOperationsNotifications(env.ds, staff(USERS.staffA), { now: NOW });
    assert.equal(items.length, 1);
    const text = JSON.stringify(items);
    for (const secret of ['Secret Staff Name', '0.93', 'started_by', 'probability']) assert.ok(!text.includes(secret), secret);
    assert.match(items[0].href, /^\/transactions\/[0-9a-f-]{36}$/);
  });
});
