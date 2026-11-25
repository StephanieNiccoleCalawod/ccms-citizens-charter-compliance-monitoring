import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ackEmailNotice } from '../../src/lib/ui/acknowledgement.js';

describe('TT3 acknowledgement email notice', () => {
  it('says plainly when the email is waiting or failed, and always points to the slip', () => {
    assert.match(ackEmailNotice({ acknowledgement_email_status: 'PENDING' }).text, /not been sent yet.*print the slip/);
    const failed = ackEmailNotice({ acknowledgement_email_status: 'FAILED' });
    assert.equal(failed.tone, 'warning');
    assert.match(failed.text, /print the slip/);
    assert.doesNotMatch(failed.text, /FAILED|PENDING/);
  });
  it('says nothing when sent or when there is no email', () => {
    assert.equal(ackEmailNotice({ acknowledgement_email_status: 'SENT' }), null);
    assert.equal(ackEmailNotice({}), null);
  });
});
