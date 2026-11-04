import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  LOGIN_NOTICES,
  REVOKE_FALLBACK_URL,
  SIGN_OUT_COPY,
  createSignOutFlow,
  noticeAfterRetry,
  parseLoginNotice,
  performSignOut,
} from '../../src/lib/auth/sign-out-flow.js';

// Fake dependencies that record what happened, in order.
function fakes({ revoke = async () => true, dirty = false } = {}) {
  const log = [];
  const deps = {
    revoke: async () => {
      log.push('revoke');
      return revoke();
    },
    clearToken: () => log.push('clearToken'),
    navigate: (url) => log.push(`navigate ${url}`),
    notify: (event) => log.push(`notify ${event.type}`),
  };
  const states = [];
  const flow = createSignOutFlow({ execute: () => performSignOut(deps), isDirty: () => dirty, onChange: (s) => states.push(s) });
  return { log, deps, flow, states };
}

describe('sign-out flow: confirmation', () => {
  it('cancelling never revokes the session', async () => {
    const { log, flow } = fakes();
    flow.request();
    assert.equal(flow.getState().open, true);
    assert.equal(flow.cancel(), true);
    assert.equal(flow.getState().open, false);
    assert.equal(await flow.confirm(), null, 'confirm after cancel does nothing');
    assert.deepEqual(log, []);
  });

  it('confirming revokes once, clears the token, then goes to the sign-in page', async () => {
    const { log, flow } = fakes();
    flow.request();
    const result = await flow.confirm();
    assert.deepEqual(log, ['revoke', 'clearToken', 'navigate /login']);
    assert.equal(result.revoked, true);
  });

  it('repeated confirmations while busy are ignored (one revocation)', async () => {
    let release;
    const { log, flow } = fakes({ revoke: () => new Promise((r) => (release = r)) });
    flow.request();
    const first = flow.confirm();
    const second = flow.confirm();
    const third = flow.confirm();
    assert.equal(flow.getState().busy, true);
    assert.equal(first, second);
    assert.equal(second, third);
    assert.equal(flow.cancel(), false, 'cannot cancel while signing out');
    assert.equal(flow.request().busy, true, 'cannot reopen while signing out');
    await Promise.resolve();
    release(true);
    await first;
    assert.deepEqual(log.filter((l) => l === 'revoke'), ['revoke']);
  });

  it('uses the unsaved-changes message only when a form is dirty', () => {
    const clean = fakes().flow;
    clean.request();
    assert.equal(clean.getState().dirty, false);
    assert.equal(clean.message(), SIGN_OUT_COPY.message);
    const dirty = fakes({ dirty: true }).flow;
    dirty.request();
    assert.equal(dirty.getState().dirty, true);
    assert.equal(dirty.message(), 'You have unsaved changes. Sign out anyway?');
  });

  it('a throwing isDirty check does not block sign-out', () => {
    const flow = createSignOutFlow({ execute: async () => null, isDirty: () => { throw new Error('boom'); } });
    assert.equal(flow.request().dirty, false);
  });
});

describe('sign-out flow: revocation failure', () => {
  for (const [label, revoke] of [
    ['Identity answers not ok', async () => false],
    ['the network fails', async () => { throw new Error('ECONNREFUSED'); }],
  ]) {
    it(`when ${label}: token still cleared, sign-in fallback with a notice in the URL`, async () => {
      const { log, flow } = fakes({ revoke });
      flow.request();
      const result = await flow.confirm();
      assert.equal(result.revoked, false);
      assert.deepEqual(log, ['revoke', 'clearToken', 'notify revoke_failed', `navigate ${REVOKE_FALLBACK_URL}`]);
      // The notice survives the full-page redirect because it travels in the URL, and only as a code.
      assert.equal(REVOKE_FALLBACK_URL, '/login?signed_out=1&notice=revoke_failed');
      assert.equal(parseLoginNotice(REVOKE_FALLBACK_URL.split('?')[1]), 'revoke_failed');
    });
  }

  it('never rejects, even when every dependency throws', async () => {
    const boom = () => { throw new Error('boom'); };
    const result = await performSignOut({ revoke: boom, clearToken: boom, navigate: boom, notify: boom });
    assert.equal(result.revoked, false);
    assert.ok(result.error instanceof Error);
  });

  it('a failed navigation un-busies the flow so the person can try again', async () => {
    const flow = createSignOutFlow({ execute: () => performSignOut({ revoke: async () => true, clearToken() {}, navigate() { throw new Error('blocked'); } }) });
    flow.request();
    await flow.confirm();
    assert.equal(flow.getState().busy, false);
  });

  it('a rejecting execute() is contained (no unhandled rejection)', async () => {
    const flow = createSignOutFlow({ execute: async () => { throw new Error('boom'); } });
    flow.request();
    const result = await flow.confirm();
    assert.ok(result.error instanceof Error);
    assert.equal(flow.getState().busy, false);
  });

  it('logs nothing (no tokens or credentials in the console)', async () => {
    const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    const printed = [];
    for (const k of Object.keys(original)) console[k] = (...a) => printed.push(a);
    try {
      const { flow } = fakes({ revoke: async () => { throw new Error('token=abc'); } });
      flow.request();
      await flow.confirm();
    } finally {
      Object.assign(console, original);
    }
    assert.deepEqual(printed, []);
  });
});

describe('sign-in page notice', () => {
  it('accepts only whitelisted notice codes and never echoes other text', () => {
    assert.equal(parseLoginNotice('?signed_out=1&notice=revoke_failed'), 'revoke_failed');
    assert.equal(parseLoginNotice('?notice=<script>alert(1)</script>'), null);
    assert.equal(parseLoginNotice('?notice=toString'), null);
    assert.equal(parseLoginNotice(''), null);
    assert.ok(!/succe/i.test(LOGIN_NOTICES.revoke_failed), 'never claims the revocation succeeded');
  });

  it('shows the failure notice only when the sign-in page retry also fails', () => {
    assert.equal(noticeAfterRetry({ requested: 'revoke_failed', retryRevoked: true }), null);
    assert.equal(noticeAfterRetry({ requested: 'revoke_failed', retryRevoked: false }), 'revoke_failed');
    assert.equal(noticeAfterRetry({ requested: null, retryRevoked: false }), 'revoke_failed', 'older ?signed_out=1 links are told too');
  });
});
