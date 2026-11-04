import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

const PAGES = {
  Transactions: 'src/app/transactions/page.js',
  Accounts: 'src/app/accounts/page.js',
  Offices: 'src/app/offices/page.js',
  Logs: 'src/app/logs/page.js',
  Services: 'src/app/services/page.js',
  'Holidays & suspensions': 'src/app/calendar/Holidays.js',
};

describe('the shared Clear filters button', () => {
  const button = read('src/components/forms/ClearFiltersButton.js');
  it('is one outlined maroon button with the text "Clear filters" and no icon', () => {
    assert.ok(button.includes('btn border border-maroon-800 bg-transparent text-maroon-800 hover:bg-maroon-50'));
    assert.ok(button.includes('Clear filters') && !button.includes('<svg'));
    assert.ok(button.includes('onClick={onClick}') && button.includes('disabled={disabled}'));
  });
});

describe('every admin filter panel works the same way (source checks, not a browser)', () => {
  for (const [name, file] of Object.entries(PAGES)) {
    it(`${name}: no Apply or Search button, the shared Clear filters button, and the shared panel look`, () => {
      const page = read(file);
      assert.ok(!page.includes('Apply filters'));
      assert.ok(page.includes("import ClearFiltersButton from '../../components/forms/ClearFiltersButton.js'"));
      assert.ok(page.includes('<ClearFiltersButton'));
      assert.ok(!page.includes('border border-maroon-800 bg-transparent'), 'no page keeps its own copy of the button style');
      assert.ok(page.includes('card p-5 sm:p-6'), 'same panel padding');
    });
  }

  it('Clear filters only shows while something differs from the default, and puts everything back to the default', () => {
    const offices = read('src/app/offices/page.js');
    assert.ok(offices.includes('{search.trim() || status ? ('));
    assert.ok(offices.includes("setSearch('');\n                setStatus('');"));
    const accounts = read('src/app/accounts/page.js');
    assert.ok(accounts.includes('{filters.q.trim() || filters.role || filters.office_id || filters.status ? ('));
    assert.ok(accounts.includes("setFilters({ q: '', role: '', office_id: '', status: '' });\n                setAppliedQuery('');\n                setPage(1);"));
    const services = read('src/app/services/page.js');
    assert.ok(services.includes("applied.search.trim() || applied.office_id || applied.classification || applied.status !== 'all'"));
    assert.ok(services.includes("applyFilters({ search: '', office_id: '', classification: '', status: 'all' })"));
    const holidays = read('src/app/calendar/Holidays.js');
    assert.ok(holidays.includes('{filters.search.trim() || filters.type || appliesFilter ? ('));
    assert.ok(holidays.includes("setFilters({ search: '', type: '', applies_to: '' })"));
    assert.ok(read('src/app/logs/page.js').includes('{filtered ? ('));
    assert.ok(read('src/app/transactions/page.js').includes('{filtered ? ('));
  });

  it('a filter change goes back to page 1', () => {
    assert.ok(read('src/app/services/page.js').includes('setPage(1);'));
    assert.ok(read('src/app/accounts/page.js').includes("if (key !== 'q') setPage(1);"));
    assert.ok(read('src/app/transactions/page.js').includes('run(next, 1, pageSize)'));
    assert.ok(read('src/app/logs/page.js').includes('// A new search or date range always starts again at page 1.'));
  });

  it('the text search waits for a short pause (400 ms; Accounts 300 ms) and Enter or leaving the field applies at once', () => {
    for (const file of ['src/app/services/page.js', 'src/app/logs/page.js', 'src/app/transactions/page.js']) {
      const page = read(file);
      assert.ok(page.includes('setTimeout(() =>') && page.includes(', 400);') && page.includes('clearTimeout(timer)'), file);
      assert.ok(page.includes('onBlur='), file);
    }
    assert.ok(read('src/app/accounts/page.js').includes('}, 300);'));
  });

  it('no duplicate request when nothing changed, and an older answer never replaces a newer one', () => {
    const services = read('src/app/services/page.js');
    assert.ok(services.includes('if (sameFilters(next, applied)) return;'));
    assert.ok(services.includes('if (request !== latestRequest.current) return;'));
    for (const file of ['src/app/accounts/page.js', 'src/app/logs/page.js', 'src/app/transactions/page.js']) {
      assert.ok(/latest(Request)?\.current/.test(read(file)), file);
    }
  });

  it('the dropdowns in these panels share the select arrow', () => {
    assert.equal([...read('src/app/calendar/Holidays.js').matchAll(/id="holiday-(type|month)" className="input select-chevron"/g)].length, 2);
    assert.ok(read('src/app/offices/page.js').includes('id="office-status" className="input select-chevron"'));
    assert.equal([...read('src/app/services/page.js').matchAll(/className="input select-chevron"/g)].length, 3);
    assert.equal([...read('src/app/accounts/page.js').matchAll(/className="input select-chevron"/g)].length, 3);
  });

  it('the Holidays filters are client-side, so only the Holidays tab is affected and no request is made', () => {
    const holidays = read('src/app/calendar/Holidays.js');
    assert.ok(holidays.includes("useState({ search: '', type: '', applies_to: '' })"));
    assert.ok(!read('src/app/calendar/page.js').includes('setFilters'));
  });
});

describe('the Services filter row and its default status (source checks, not a browser)', () => {
  const page = read('src/app/services/page.js');
  it('Status starts as All, listed first, and Clear filters goes back to All and is hidden while All is the only setting', () => {
    assert.ok(page.includes("useState({ search: '', office_id: '', classification: '', status: 'all' })"));
    assert.ok(page.includes("applied.status !== 'all'"));
    assert.ok(page.includes("applyFilters({ search: '', office_id: '', classification: '', status: 'all' })"));
    assert.ok(page.indexOf('<option value="all">All</option>') < page.indexOf('<option value="active">Active</option>'));
  });
  it('the fields are narrow enough that Clear filters and + Add Service fit on the same row on a laptop', () => {
    for (const width of ['sm:w-64', 'sm:w-52', 'sm:w-40', 'sm:w-32']) assert.ok(page.includes(width), width);
    assert.ok(page.includes('flex flex-wrap items-end gap-x-4 gap-y-4'));
  });
});
