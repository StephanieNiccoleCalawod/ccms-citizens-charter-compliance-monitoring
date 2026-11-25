// Deleting a notification: ask first, say it is done, and never show a deleted notice again.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import { deleteNotifications } from '../../src/lib/api/notifications.js';
import { mergeNotifications, withoutKeys } from '../../src/lib/ui/notifications.js';
import { confirmDelete, deleteQuestion, deletedMessage, NOT_DELETED } from '../../src/lib/ui/notice-delete.js';
import { dismissResult, getResult, resetNotifications } from '../../src/lib/ui/notify.js';

afterEach(() => resetNotifications());
const ok = (value) => ({ status: 'fulfilled', value });
const flush = () => new Promise((r) => setImmediate(r));

describe('merge', () => {
  const oversight = ok({ items: [{ key: 'complaint:1:RESOLVED', kind: 'COMPLAINT', at: '2026-11-25T01:00:00Z' }, { key: 'calendar:2', kind: 'CALENDAR', at: '2026-11-24T01:00:00Z' }], read_keys: [], deleted_keys: ['calendar:2'] });
  const operations = ok({ items: [{ key: 'overdue:t1', kind: 'OVERDUE' }, { key: 'deadline:t2', kind: 'DEADLINE' }] });
  it('hides what the server says is deleted, in both feeds', () => {
    const keys = mergeNotifications({ oversight: ok({ ...oversight.value, deleted_keys: ['calendar:2', 'overdue:t1'] }), operations }).items.map((i) => i.key);
    assert.deepEqual(keys.sort(), ['complaint:1:RESOLVED', 'deadline:t2']);
  });
  it('hides a delete that the server has not confirmed yet', () => {
    const keys = mergeNotifications({ oversight, operations }, { pendingDeletedKeys: ['deadline:t2'] }).items.map((i) => i.key);
    assert.ok(!keys.includes('deadline:t2') && !keys.includes('calendar:2'));
  });
  it('withoutKeys removes only the named keys', () => {
    assert.deepEqual(withoutKeys([{ key: 'a' }, { key: 'b' }], ['a']), [{ key: 'b' }]);
  });
});

describe('confirm, then done', () => {
  it('asks first and does nothing until the person confirms', async () => {
    let ran = 0;
    confirmDelete({ run: async () => { ran += 1; } });
    const open = getResult();
    assert.equal(open.variant, 'confirm');
    assert.equal(open.message, deleteQuestion(1));
    assert.match(open.message, /Are you sure you want to delete this notification/);
    assert.equal(ran, 0);
    dismissResult(); // Cancel
    assert.equal(ran, 0);
  });
  it('on Delete it runs, then shows a Success result', async () => {
    let ran = 0;
    confirmDelete({ run: async () => { ran += 1; } });
    getResult().onConfirm();
    await flush();
    assert.equal(ran, 1);
    assert.equal(getResult().variant, 'success');
    assert.equal(getResult().message, deletedMessage(1));
  });
  it('when the server does not confirm, it says Failed and not Success', async () => {
    confirmDelete({ run: async () => { throw new Error('down'); } });
    getResult().onConfirm();
    await flush();
    assert.equal(getResult().variant, 'error');
    assert.equal(getResult().message, NOT_DELETED);
  });
});

describe('api', () => {
  it('posts the keys to the delete endpoint', async () => {
    const calls = [];
    await deleteNotifications(['calendar:1'], async (url, init) => { calls.push([url, init]); return { deleted: 1 }; });
    assert.deepEqual(calls, [['/api/logs/analytics/notifications/delete', { method: 'POST', body: { keys: ['calendar:1'] } }]]);
  });
});

describe('Notification Center: select, then delete', () => {
  const src = readFileSync(new URL('../../src/components/notifications/NotificationCenter.js', import.meta.url), 'utf8');
  it('has Select all and Delete selected, and no delete icon on each row', () => {
    assert.match(src, /data-testid="nc-select-all"/);
    assert.match(src, /data-testid="nc-delete-selected"/);
    assert.match(src, /data-testid="nc-select"/);
    assert.doesNotMatch(src, /data-testid="nc-delete"/);
  });
  it('the confirm for several notices counts them, and is red', () => {
    assert.match(deleteQuestion(3), /delete these 3 notifications/);
    assert.equal(deletedMessage(3), '3 notifications were deleted.');
    confirmDelete({ count: 3, run: async () => {} });
    assert.equal(getResult().danger, true);
  });
});
