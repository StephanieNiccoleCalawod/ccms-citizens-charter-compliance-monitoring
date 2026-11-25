import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { EMPTY_SERVICE_FORM, formToBody, serviceToForm } from '../../src/lib/ui/service-form.js';

const read = (path) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

describe('S8-58 has_fee', () => {
  it('a new service charges a fee; an older Core without the field keeps that', () => {
    assert.equal(EMPTY_SERVICE_FORM.has_fee, true);
    assert.equal(serviceToForm({}).has_fee, true);
  });
  it('a free service stays free through edit and save', () => {
    const form = serviceToForm({ has_fee: false });
    assert.equal(form.has_fee, false);
    assert.equal(formToBody(form, false).has_fee, false);
  });
  it('shows the proof-of-payment section only when the service has a fee or a receipt already exists', () => {
    const panel = read('components/transactions/ReceiptPanel.js');
    assert.match(panel, /if \(!hasFee && !state\.loading && !state\.receipt\) return null;/);
    assert.match(panel, /service\?\.has_fee !== false/);
  });
});
