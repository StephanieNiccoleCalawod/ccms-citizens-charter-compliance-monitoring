import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACCESS_TEXT, writtenDate } from '../src/modules/notifications/notifications.js';

describe('S8-52 notices to the requester', () => {
  it('say what happened in plain words, with the end date written out', () => {
    assert.equal(ACCESS_TEXT.ACCESS_GRANTED('Reports per person', { ends_on: '2026-12-24' }), 'Your request for “Reports per person” was approved until December 24, 2026.');
    assert.match(ACCESS_TEXT.ACCESS_DENIED('Export reports to CSV'), /was not approved/);
    assert.match(ACCESS_TEXT.ACCESS_REVOKED('Export reports to CSV'), /removed by the Super Admin/);
    assert.match(ACCESS_TEXT.ACCESS_EXPIRED('Export reports to CSV'), /has ended/);
  });
  it('writes only real dates', () => { assert.equal(writtenDate('nope'), ''); assert.equal(writtenDate('2027-01-02'), 'January 2, 2027'); });
});
