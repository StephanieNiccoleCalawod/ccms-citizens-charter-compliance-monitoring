import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseServiceFields } from '../src/lib/catalogue/catalogue-rules.js';
import { toServiceDto } from '../src/lib/catalogue/services.js';

describe('S8-58 has_fee on a service', () => {
  it('reads true or false only', () => {
    const details = {};
    parseServiceFields({ has_fee: 'yes' }, details, { mode: 'update' });
    assert.equal(details.has_fee, 'Has fee must be true or false');
  });
  it('shows has_fee in the service answer, true when the row has no value yet', () => {
    assert.equal(toServiceDto({ has_fee: false }).has_fee, false);
    assert.equal(toServiceDto({}).has_fee, true);
  });
  it('derives new and imported service flags from fees and the approved exceptions', () => {
    for (const fees of [undefined, null, '', '\t None \n']) {
      assert.equal(parseServiceFields({ fees }).hasFee, false);
    }
    assert.equal(parseServiceFields({ fees: 'PHP 150' }).hasFee, true);
    assert.equal(parseServiceFields({ fees: 'None. See other fees below.' }).hasFee, true);
    assert.equal(parseServiceFields({ service_code: 'PUP-REG-CRD-005', fees: 'NONE (covered by RA 10931)' }, {}, { mode: 'seed' }).hasFee, false);
    for (const service_code of ['PUP-ACCT-CLR-001', 'PUP-ADMREG-ACC-003', 'PUP-ADMREG-ADM-001']) {
      assert.equal(parseServiceFields({ service_code, fees: 'None' }, {}, { mode: 'seed' }).hasFee, true);
    }
  });
  it('preserves explicit administrator flags and leaves existing flags alone on an ordinary edit', () => {
    assert.equal(parseServiceFields({ fees: 'None', has_fee: true }).hasFee, true);
    assert.equal(parseServiceFields({ fees: 'PHP 150', has_fee: false }).hasFee, false);
    assert.equal(parseServiceFields({ fees: 'None' }, {}, { mode: 'edit' }).hasFee, undefined);
  });
});
