import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { smsSyncNotice } from '../../src/lib/api/calendar.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('Calendar page notice about the Syllabus Management System (SMS)', () => {
  it('says nothing when there is no issue', () => {
    assert.equal(smsSyncNotice(null), null);
    assert.equal(smsSyncNotice({ sms_issue: null }), null);
    assert.equal(smsSyncNotice({}), null);
  });

  it('a refused key is its own state and says sending stops until the key is fixed', () => {
    const notice = smsSyncNotice({ sms_issue: { state: 'KEY_REJECTED', at: '2026-11-06T10:00:00.000Z' } });
    assert.equal(notice.state, 'KEY_REJECTED');
    assert.match(notice.text, /Syllabus Management System \(SMS\) refused the key/);
    assert.match(notice.text, /until the key is fixed/);
  });

  it('another failure says it is retried and the changes are saved', () => {
    const notice = smsSyncNotice({ sms_issue: { state: 'FAILED' } });
    assert.equal(notice.state, 'FAILED');
    assert.match(notice.text, /retried automatically/);
    assert.match(notice.text, /changes are saved/);
  });

  it('never names SMS as Audit, and prints nothing from the service', () => {
    for (const state of ['KEY_REJECTED', 'FAILED']) assert.doesNotMatch(smsSyncNotice({ sms_issue: { state, message: 'secret detail' } }).text, /audit|secret detail/i);
  });

  it('the panel shows the notice and reads the new received-at field', () => {
    const panel = read('src/app/calendar/SyncPanel.js');
    assert.match(panel, /smsSyncNotice\(data\)/);
    assert.match(panel, /sms_last_received/);
    assert.match(panel, /data-testid="sms-notice"/);
  });
});
