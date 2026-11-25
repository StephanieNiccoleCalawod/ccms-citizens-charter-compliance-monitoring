import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SERVICE_HAS_NO_FEE, assertServiceHasFee } from '../src/modules/receipts/fee-check.js';

const core = (answer) => ({ standardAsOf: async () => { if (answer instanceof Error) throw answer; return answer; } });

describe('S8-58 proof of payment only for a service with a fee', () => {
  it('refuses a service with no fee', async () => {
    await assert.rejects(assertServiceHasFee(core({ has_fee: false }), 'svc', '2026-11-25'), (e) => e.status === 409 && e.code === 'SERVICE_HAS_NO_FEE' && e.message === SERVICE_HAS_NO_FEE);
  });
  it('accepts a service with a fee, and an older Core that does not send the field', async () => {
    await assertServiceHasFee(core({ has_fee: true }), 'svc', '2026-11-25');
    await assertServiceHasFee(core({}), 'svc', '2026-11-25');
  });
  it('says so when Core cannot be reached, never allowing by guess', async () => {
    await assert.rejects(assertServiceHasFee(core(new Error('down')), 'svc', '2026-11-25'), (e) => e.status === 503 && e.code === 'SERVICE_FEE_UNAVAILABLE');
  });
});
