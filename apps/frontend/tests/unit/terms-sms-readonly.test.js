import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { smsTermsNotice } from '../../src/lib/api/calendar.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('Academic terms tab while SMS owns the terms', () => {
  it('says nothing when the switch is off or everything is fine', () => {
    assert.equal(smsTermsNotice(null), null);
    assert.equal(smsTermsNotice({ enabled: false, state: 'OFF' }), null);
    assert.equal(smsTermsNotice({ enabled: true, state: 'OK' }), null);
  });

  it('has fixed text for a refused key, a missing setup and an unreachable SMS', () => {
    assert.match(smsTermsNotice({ enabled: true, state: 'KEY_REJECTED' }), /refused the key/);
    assert.match(smsTermsNotice({ enabled: true, state: 'NOT_CONFIGURED' }), /not set up yet/);
    assert.match(smsTermsNotice({ enabled: true, state: 'UNAVAILABLE', message: 'secret detail' }), /could not be read/);
    assert.doesNotMatch(smsTermsNotice({ enabled: true, state: 'UNAVAILABLE', message: 'secret detail' }), /secret/);
  });

  it('the tab reads the SMS terms first and has no Add, Edit or form at all (source check, not a browser)', () => {
    const tab = read('src/app/calendar/Terms.js');
    assert.match(tab, /\/api\/calendar\/terms\/sms/);
    assert.match(tab, /cannot be changed here/);
    assert.match(tab, /data-testid="terms-notice"/);
    assert.doesNotMatch(tab, /Add academic term|Add Term|Edit Term|RowActionMenu|method: 'POST'|method: 'PUT'|<form|canWrite/);
    assert.doesNotMatch(read('src/app/calendar/page.js'), /<Terms [^/]/);
  });
});
