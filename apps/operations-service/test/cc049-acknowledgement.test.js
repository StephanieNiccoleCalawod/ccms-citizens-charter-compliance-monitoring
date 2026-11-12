// CC049 acknowledgement at Start (spec 6.3, K25): queueing, idempotent delivery, crash recovery and privacy.
// Authored for Codex; not run by the author.
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { POST as startRoute } from '../src/app/api/transactions/route.js';
import { createIdempotentMailTransport, TransportError } from '../src/lib/idempotent-mail.js';
import {
  ACK_QUOTE_LINE,
  acknowledgementKey,
  buildAcknowledgement,
  runAcknowledgementJob,
  sendAcknowledgement,
} from '../src/modules/transaction/acknowledgement.js';
import { buildReceipt } from '../src/modules/transaction/receipt.js';
import { SERVICE_A, call, req, resetData, seedCoreServices, setupTestEnv, tokens } from './helpers.js';

let env;
before(async () => {
  env = await setupTestEnv();
  seedCoreServices(env.core);
});
after(async () => env?.teardown());
beforeEach(async () => {
  env.core.reset();
  await resetData(env.ds);
});

const start = (over = {}, token = tokens.officeStaffA) => call(startRoute, req('POST', '/transactions', {
  token, body: { service_id: SERVICE_A, client_type: 'EXTERNAL', requirements_confirmed: true, ...over },
}));
const emails = () => env.ds.query('SELECT * FROM transaction_emails ORDER BY created_at');

/** A provider stand-in with the documented Resend semantics: one delivery per key, the same id for a repeat. */
function fakeProvider({ failFirst = 0, crashAfterAccept = false } = {}) {
  const delivered = new Map();
  const calls = [];
  let failures = failFirst;
  return {
    calls,
    delivered,
    transport: {
      configured: true,
      async send(message) {
        calls.push(message);
        if (failures > 0) {
          failures -= 1;
          throw new TransportError('HTTP_503', 'busy', { retryable: true });
        }
        if (!delivered.has(message.idempotencyKey)) delivered.set(message.idempotencyKey, { id: `msg-${delivered.size + 1}`, message });
        if (crashAfterAccept) throw new Error('worker died after the provider accepted');
        return { providerMessageId: delivered.get(message.idempotencyKey).id };
      },
    },
  };
}

describe('CC049 queueing at Start', () => {
  it('queues exactly one ACKNOWLEDGEMENT in the Start transaction when there is an email, none without', async () => {
    const withEmail = await start({ client_email: 'client@example.com' });
    assert.equal(withEmail.status, 201);
    const rows = await emails();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'ACKNOWLEDGEMENT');
    assert.equal(rows[0].status, 'PENDING');
    assert.equal(rows[0].idempotency_key, acknowledgementKey(withEmail.body.transaction_id));
    assert.equal(JSON.stringify(rows[0]).includes('client@example.com'), false, 'the address is not copied');
    assert.equal(withEmail.body.acknowledgement_email_status, 'PENDING');
    await start({}, tokens.officeStaffA2);
    assert.equal((await emails()).length, 1, 'no email, no acknowledgement');
  });
});

describe('CC049 delivery', () => {
  it('sends once; a later run or a retry never sends again', async () => {
    await start({ client_email: 'client@example.com' });
    const provider = fakeProvider();
    assert.equal((await runAcknowledgementJob({ dataSource: env.ds, transport: provider.transport })).sent, 1);
    assert.equal((await runAcknowledgementJob({ dataSource: env.ds, transport: provider.transport })).checked, 0);
    assert.equal(provider.calls.length, 1);
    const [row] = await emails();
    assert.equal(row.status, 'SENT');
    assert.equal(row.provider_message_id, 'msg-1');
    const audit = await env.ds.query("SELECT payload FROM audit_outbox WHERE payload->>'action' = 'ACKNOWLEDGEMENT_EMAIL_SENT'");
    assert.equal(audit.length, 1);
    assert.equal(JSON.stringify(audit[0].payload).includes('@'), false, 'no address in the audit');
  });

  it('retries a retryable failure with the same key and backoff, then succeeds', async () => {
    await start({ client_email: 'client@example.com' });
    const provider = fakeProvider({ failFirst: 1 });
    const [queued] = await emails();
    assert.equal(await sendAcknowledgement(env.ds, provider.transport, queued.email_id), 'retry');
    await env.ds.query("UPDATE transaction_emails SET next_attempt_at = now() - interval '1 second'");
    assert.equal(await sendAcknowledgement(env.ds, provider.transport, queued.email_id), 'sent');
    assert.equal(new Set(provider.calls.map((c) => c.idempotencyKey)).size, 1);
    assert.deepEqual(provider.calls[0], provider.calls[1], 'byte-identical payload on every attempt');
  });

  it('recovers an accepted send after a worker crash without a second delivery', async () => {
    await start({ client_email: 'client@example.com' });
    const crashing = fakeProvider({ crashAfterAccept: true });
    const [queued] = await emails();
    // The worker dies after the provider accepted: simulate by leaving the claim in place (lease not yet released).
    await env.ds.query("UPDATE transaction_emails SET status = 'SENDING', attempts = 1, claim_token = gen_random_uuid(), claim_until = now() - interval '1 second', first_attempt_at = now() WHERE email_id = $1", [queued.email_id]);
    crashing.delivered.set(queued.idempotency_key, { id: 'msg-original' });
    const healthy = fakeProvider();
    healthy.delivered.set(queued.idempotency_key, { id: 'msg-original' });
    assert.equal(await sendAcknowledgement(env.ds, healthy.transport, queued.email_id), 'sent');
    assert.equal(healthy.delivered.size, 1, 'the provider saw the same key: no second delivery');
    assert.equal((await emails())[0].provider_message_id, 'msg-original');
  });

  it('two workers on the same row: only one claim wins', async () => {
    await start({ client_email: 'client@example.com' });
    const provider = fakeProvider();
    const [queued] = await emails();
    const results = await Promise.all([1, 2].map(() => sendAcknowledgement(env.ds, provider.transport, queued.email_id)));
    assert.deepEqual(results.sort(), ['sent', 'skipped']);
    assert.equal(provider.delivered.size, 1);
  });

  it('never re-sends outside the safe idempotency window: the row ends FAILED for review', async () => {
    await start({ client_email: 'client@example.com' });
    await env.ds.query("UPDATE transaction_emails SET status = 'SENDING', attempts = 1, claim_token = gen_random_uuid(), claim_until = now() - interval '1 second', first_attempt_at = now() - interval '21 hours'");
    const provider = fakeProvider();
    const counts = await runAcknowledgementJob({ dataSource: env.ds, transport: provider.transport });
    assert.equal(provider.calls.length, 0);
    assert.equal(counts.failed, 1);
    const [row] = await emails();
    assert.equal(row.status, 'FAILED');
    assert.equal(row.last_error_code, 'DEDUPE_WINDOW_EXPIRED');
  });

  it('stays disabled (no attempt counted) without a supported idempotent provider; SMTP is never used', async () => {
    await start({ client_email: 'client@example.com' });
    const disabled = createIdempotentMailTransport({ provider: 'smtp', apiKey: 'x', from: 'a@b.c' });
    assert.equal(disabled.configured, false);
    const result = await runAcknowledgementJob({ dataSource: env.ds, transport: disabled });
    assert.equal(result.skipped, true);
    assert.equal((await emails())[0].attempts, 0);
  });
});

describe('CC049 content and privacy', () => {
  it('the acknowledgement carries the RA 11032 items; the receipt keeps its no-staff-names rule', () => {
    const row = {
      client_email: 'c@example.com', tracking_no: 'PUP-OSAS-20261112-0001', office_name: 'Student Affairs', office_code: 'PUP-OSAS',
      service_name: 'Transcript of Records', started_by_name: 'Maria Officer', started_by_position: 'Administrative Aide III',
      started_at: new Date('2026-11-12T01:30:00Z'), ended_at: new Date('2026-11-12T03:00:00Z'),
    };
    const ack = buildAcknowledgement(row);
    for (const part of ['PUP-OSAS-20261112-0001', 'Student Affairs', 'Transcript of Records', 'Maria Officer', 'Administrative Aide III', '11/12/2026 9:30 AM', ACK_QUOTE_LINE]) {
      assert.ok(ack.text.includes(part), part);
    }
    assert.deepEqual(buildAcknowledgement(row), ack, 'deterministic');
    assert.equal(buildReceipt(row).text.includes('Maria Officer'), false);
  });
});

describe('CC049 Resend adapter (documented Idempotency-Key)', () => {
  const transport = (respond) => {
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push({ url, init }); return respond(); };
    return { seen, t: createIdempotentMailTransport({ provider: 'resend', apiKey: 're_test', from: 'CCMS <no-reply@example.com>', apiUrl: 'https://provider.test', fetchImpl }) };
  };
  const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('sends the key in the Idempotency-Key header and returns the provider id', async () => {
    const { seen, t } = transport(() => response(200, { id: 'abc' }));
    assert.deepEqual(await t.send({ to: 'c@example.com', subject: 's', text: 't', idempotencyKey: 'ccms-ack-1' }), { providerMessageId: 'abc' });
    assert.equal(seen[0].url, 'https://provider.test/emails');
    assert.equal(seen[0].init.headers['idempotency-key'], 'ccms-ack-1');
  });

  it('classifies 409 concurrent as retryable and a key/payload mismatch as final', async () => {
    const concurrent = transport(() => response(409, { name: 'concurrent_idempotent_requests' })).t;
    await assert.rejects(concurrent.send({ to: 'c@example.com', subject: 's', text: 't', idempotencyKey: 'k' }), (e) => e.retryable === true && e.code === 'IN_PROGRESS');
    const mismatch = transport(() => response(409, { name: 'invalid_idempotent_request' })).t;
    await assert.rejects(mismatch.send({ to: 'c@example.com', subject: 's', text: 't', idempotencyKey: 'k' }), (e) => e.retryable === false);
    const busy = transport(() => response(503, {})).t;
    await assert.rejects(busy.send({ to: 'c@example.com', subject: 's', text: 't', idempotencyKey: 'k' }), (e) => e.retryable === true);
  });

  it('is disabled until the provider, key and sender are all configured', () => {
    assert.equal(createIdempotentMailTransport({}).configured, false);
    assert.equal(createIdempotentMailTransport({ provider: 'resend', apiKey: '', from: 'x' }).configured, false);
  });
});
