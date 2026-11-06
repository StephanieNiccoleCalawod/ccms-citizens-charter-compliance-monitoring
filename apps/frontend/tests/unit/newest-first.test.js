import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { byNewest, fetchEveryPage, pageSlice, sortNewestFirst } from '../../src/lib/ui/newest-first.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const rec = (id, created_at) => ({ id, created_at });

describe('newest first', () => {
  it('orders by created_at, newest first, without changing the input', () => {
    const input = [rec('a', '2026-01-01T00:00:00Z'), rec('c', '2026-03-01T00:00:00Z'), rec('b', '2026-02-01T00:00:00Z')];
    assert.deepEqual(sortNewestFirst(input).map((r) => r.id), ['c', 'b', 'a']);
    assert.deepEqual(input.map((r) => r.id), ['a', 'c', 'b']);
  });
  it('uses the real instant, not the text, and puts a record without a readable created_at last, keeping its order', () => {
    const list = [rec('x', null), rec('old', '2026-01-01T00:00:00+08:00'), rec('new', '2026-01-01T00:00:00Z'), rec('y', 'nonsense')];
    assert.deepEqual(sortNewestFirst(list).map((r) => r.id), ['new', 'old', 'x', 'y']);
    assert.equal(byNewest(rec('p', null), rec('q', null)), 0);
    assert.deepEqual(sortNewestFirst(undefined), []);
  });
  it('a just-created record is the first row, wherever the service put it', () => {
    const az = [rec('Alpha', '2026-01-01T00:00:00Z'), rec('Zulu', '2026-01-02T00:00:00Z'), rec('Middle', '2026-06-01T00:00:00Z')];
    assert.equal(sortNewestFirst(az)[0].id, 'Middle');
  });
  it('pages the sorted list here', () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    assert.deepEqual(pageSlice(items, 1, 10), { rows: items.slice(0, 10), total: 25 });
    assert.deepEqual(pageSlice(items, 3, 10).rows, [20, 21, 22, 23, 24]);
    assert.deepEqual(pageSlice([], 1, 10), { rows: [], total: 0 });
  });
});

describe('reading every page of a server list', () => {
  it('asks page after page with the same filters until the total is reached', async () => {
    const urls = [];
    const data = Array.from({ length: 230 }, (_, i) => ({ id: i }));
    const items = await fetchEveryPage(
      async (url) => {
        urls.push(url);
        const page = Number(/page=(\d+)/.exec(url)[1]);
        return { items: data.slice((page - 1) * 100, page * 100), total: 230 };
      },
      (page, size) => `/x?q=a&page=${page}&page_size=${size}`,
    );
    assert.equal(items.length, 230);
    assert.deepEqual(urls, ['/x?q=a&page=1&page_size=100', '/x?q=a&page=2&page_size=100', '/x?q=a&page=3&page_size=100']);
  });
  it('stops on an empty page, and with no items at all', async () => {
    assert.deepEqual(await fetchEveryPage(async () => ({ items: [], total: 5 }), () => '/x'), []);
    assert.deepEqual(await fetchEveryPage(async () => ({}), () => '/x'), []);
  });
});

describe('the tables (source checks, not a browser)', () => {
  it('Offices, Accounts and Services order newest first', () => {
    assert.ok(read('src/app/offices/page.js').includes('sortNewestFirst(state.items)'));
    assert.ok(read('src/app/accounts/page.js').includes('const items = sortNewestFirst(all);'));
    assert.ok(read('src/app/services/page.js').includes('const items = sortNewestFirst(all);'));
    assert.ok(read('src/app/accounts/page.js').includes('pageSlice(list.items, page, pageSize).rows'));
    assert.ok(read('src/app/services/page.js').includes('pageSlice(state.items, page, pageSize).rows'));
  });
  it('a save reloads the list, so the new record appears without a manual refresh', () => {
    for (const file of ['src/app/accounts/page.js', 'src/app/services/page.js', 'src/app/offices/page.js']) {
      assert.ok(/notify\.success\([\s\S]{0,500}await (load|reload)\(\)/.test(read(file)), file);
    }
    assert.ok(read('src/app/transactions/page.js').includes('run(applied, 1, pageSize)'), 'a new transaction reloads page 1');
  });
});
