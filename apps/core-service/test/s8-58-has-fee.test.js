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
});
