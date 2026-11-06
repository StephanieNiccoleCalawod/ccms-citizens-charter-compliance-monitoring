import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

const SEARCHES = {
  Transactions: ['src/app/transactions/page.js', 'tx-q'],
  Accounts: ['src/app/accounts/page.js', 'account-search'],
  Offices: ['src/app/offices/page.js', 'office-search'],
  Logs: ['src/app/logs/page.js', 'audit-search'],
  Services: ['src/app/services/page.js', 'svc-search'],
  'Holidays & suspensions': ['src/app/calendar/Holidays.js', 'holiday-search'],
};

describe('the shared search input (source checks, not a browser)', () => {
  const input = read('src/components/forms/SearchInput.js');
  it('has one magnifying glass inside the left of the field, the placeholder "Search...", and text kept clear of the icon', () => {
    assert.equal([...input.matchAll(/<svg/g)].length, 1);
    assert.ok(input.includes('absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2'), 'icon vertically centred, inside the left');
    assert.ok(input.includes('pointer-events-none'), 'the icon never blocks a click');
    assert.ok(input.includes('placeholder="Search..."'));
    assert.ok(input.includes('input pl-9'), 'same input style as every other field, with room for the icon');
  });
  it('passes everything else (id, value, handlers, aria, maxLength) straight to the input, so each page keeps its own behavior', () => {
    assert.ok(input.includes('{...props}'));
    assert.ok(input.indexOf('{...props}') < input.indexOf('placeholder="Search..."'), 'the placeholder cannot be overridden');
  });

  for (const [name, [file, id]] of Object.entries(SEARCHES)) {
    it(`${name}: uses the shared search input with no placeholder, icon or Search button of its own`, () => {
      const page = read(file);
      assert.ok(page.includes("import SearchInput from '../../components/forms/SearchInput.js'"));
      assert.match(page, new RegExp(`<SearchInput\\s+id="${id}"`));
      assert.ok(!page.includes('placeholder="Search'), 'no page-specific search placeholder');
      assert.ok(!new RegExp(`<input[^>]*id="${id}"`).test(page), 'the plain input is gone');
      assert.ok(!/>\s*Search\s*<\/button>/.test(page), 'no separate Search button');
    });
  }

  it('the search behavior and requests are untouched: debounce, blur and Enter still go through the same handlers', () => {
    assert.ok(read('src/app/transactions/page.js').includes("onBlur={() => draft.q.trim() !== (applied.q ?? '') && applyNow(draft)}"));
    assert.ok(read('src/app/transactions/page.js').includes('maxLength={TRACKING_MAX}'));
    assert.ok(read('src/app/services/page.js').includes('onBlur={() => filters.search.trim() !== applied.search.trim() && applyFilters(filters)}'));
    assert.ok(read('src/app/logs/page.js').includes("aria-describedby={describedBy('search', 'audit-search-help')}"));
    assert.ok(read('src/app/accounts/page.js').includes("onChange={(e) => setFilter('q', e.target.value)}"));
  });
});
