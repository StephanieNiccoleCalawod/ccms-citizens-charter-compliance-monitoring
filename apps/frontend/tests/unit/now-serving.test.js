// CC059 "Now serving" screen: rules, calls and source checks (not a browser).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { findOfficeByCode, getNowServing } from '../../src/lib/api/now-serving.js';
import { INITIAL, REFRESH_MS, failed, headline, isStale, succeeded } from '../../src/lib/ui/now-serving.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('calls', () => {
  it('finds the office by its code, ignoring case, from the public list', async () => {
    const f = async () => ({ items: [{ office_id: 'o1', office_code: 'PUP-OSAS', office_name: 'Student Affairs' }] });
    assert.equal((await findOfficeByCode('pup-osas', f)).office_id, 'o1');
    assert.equal(await findOfficeByCode('NOPE', f), null);
  });
  it('reads the public Operations route with the office id', async () => {
    let path;
    await getNowServing('o1', async (p) => { path = p; return {}; });
    assert.equal(path, '/api/operations/queue/public/now-serving?office_id=o1');
  });
});

describe('screen state', () => {
  it('refreshes every 5 seconds (AC1)', () => assert.equal(REFRESH_MS, 5000));
  it('keeps at most the next three and tolerates an odd answer', () => {
    assert.deepEqual(succeeded({ current: 'A-1', next: ['A-2', 'A-3', 'A-4', 'A-5'] }, 1).view, { current: 'A-1', next: ['A-2', 'A-3', 'A-4'] });
    assert.deepEqual(succeeded({}, 1).view, { current: null, next: [] });
  });
  it('keeps the last numbers on a failed read, marks them old after three failures, and recovers', () => {
    let s = succeeded({ current: 'A-1', next: [] }, 1);
    s = failed(s); s = failed(s);
    assert.equal(isStale(s), false); assert.equal(s.view.current, 'A-1');
    s = failed(s);
    assert.equal(isStale(s), true);
    assert.equal(isStale(succeeded({ current: 'A-2', next: [] }, 2)), false);
  });
  it('shows an error only when nothing was ever read, and words an empty queue', () => {
    assert.equal(failed(INITIAL).status, 'error');
    assert.equal(headline({ current: null }), 'No ticket is being served');
    assert.equal(headline({ current: 'A-9' }), 'A-9');
  });
});

describe('screen source', () => {
  it('is public (no app shell, no token) and shows no personal field', () => {
    const src = read('src/components/queue/NowServingScreen.js');
    assert.ok(!src.includes('AppShell') && !src.includes('apiFetch'));
    assert.ok(!/lane|email|full_?name|started_at/i.test(src));
    assert.match(read('src/app/queue/[officeCode]/now-serving/page.js'), /NowServingScreen/);
  });
});
