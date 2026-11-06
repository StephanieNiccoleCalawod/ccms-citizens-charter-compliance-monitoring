import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { directoryHref, filterByTime, officeCounts, sequenceLabel, showingRange, sortByName, standardMinutes } from '../../src/lib/ui/public-directory.js';

const svc = (name, office, d, h, m) => ({ service_id: name, service_name: name, office_name: office, duration_days: d, duration_hours: h, duration_minutes: m });
const LIST = [
  svc('Bravo', 'Registrar', 0, 0, 5),
  svc('Alpha', 'Registrar', 0, 0, 15),
  svc('Charlie', 'Library', 2, 0, 23),
  svc('Delta', 'Library', 0, 1, 0),
  svc('Echo', 'Cashier', 0, 0, 5),
];

describe('time filters use the real standard and never convert working days', () => {
  it('only a standard without working days has minutes', () => {
    assert.equal(standardMinutes(svc('x', 'o', 0, 0, 5)), 5);
    assert.equal(standardMinutes(svc('x', 'o', 0, 1, 30)), 90);
    assert.equal(standardMinutes(svc('x', 'o', 2, 0, 23)), null);
  });
  it('Under 10 min and Under 20 min are strict, and "Any time" keeps everything', () => {
    assert.deepEqual(filterByTime(LIST, '10').map((s) => s.service_name), ['Bravo', 'Echo']);
    assert.deepEqual(filterByTime(LIST, '20').map((s) => s.service_name), ['Bravo', 'Alpha', 'Echo']);
    assert.equal(filterByTime(LIST, '').length, 5);
    assert.deepEqual(filterByTime([svc('ten', 'o', 0, 0, 10)], '10'), []);
  });
  it('a service with working days is never "under N min", however small its minutes part is', () => {
    assert.deepEqual(filterByTime([svc('days', 'o', 1, 0, 1)], '20'), []);
  });
});

describe('sorting', () => {
  it('A to Z and Z to A by service name, without changing the input', () => {
    const before = LIST.map((s) => s.service_name);
    assert.deepEqual(sortByName(LIST).map((s) => s.service_name), ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    assert.deepEqual(sortByName(LIST, 'desc').map((s) => s.service_name), ['Echo', 'Delta', 'Charlie', 'Bravo', 'Alpha']);
    assert.deepEqual(LIST.map((s) => s.service_name), before);
  });
});

describe('office navigation counts', () => {
  it('counts every office from the services, A to Z, with the total', () => {
    assert.deepEqual(officeCounts(LIST), { total: 5, offices: [{ name: 'Cashier', count: 1 }, { name: 'Library', count: 2 }, { name: 'Registrar', count: 2 }] });
  });
  it('an empty list has no offices and a zero total', () => {
    assert.deepEqual(officeCounts([]), { total: 0, offices: [] });
  });
});

describe('pagination text', () => {
  it('the visible range and the numbering', () => {
    assert.deepEqual(showingRange(1, 10, 36), { from: 1, to: 10 });
    assert.deepEqual(showingRange(4, 10, 36), { from: 31, to: 36 });
    assert.deepEqual(showingRange(1, 10, 0), { from: 0, to: 0 });
    assert.equal(sequenceLabel(1), '01');
    assert.equal(sequenceLabel(12), '12');
    assert.equal(sequenceLabel(105), '105');
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('the split-screen directory (source checks, not a browser)', () => {
  const dir = read('src/components/public/PublicDirectory.js');
  const home = read('src/app/page.js');
  it('the directory lives at /directory (the same component, no second directory); the signed-out home is the landing page', () => {
    const route = read('src/app/directory/page.js');
    assert.ok(route.includes('<PublicDirectory catalogue={catalogue} />'));
    assert.ok(home.includes('<LandingHero />') && !home.includes('<PublicDirectory'));
    assert.ok(!home.includes('TILES') && !home.includes('hero-bg'));
    assert.ok(!dir.includes('lg:grid-cols-3'));
  });
  it('the landing page: Staff Login to /login, Browse all services and the search go to the directory, and ?q= is applied', () => {
    const hero = read('src/components/public/LandingHero.js');
    assert.ok(hero.includes('href="/login"') && hero.includes('href={DIRECTORY_PATH}'));
    assert.ok(hero.includes('router.push(directoryHref(query))'));
    assert.ok(hero.includes('placeholder="Search by service or office name"') && hero.includes('Browse all services'));
    assert.ok(hero.includes('<em className="text-[#FFDF00]">what to bring</em>'));
    assert.ok(hero.includes('Every service shows its requirements, steps, and processing time.'));
    assert.ok(read('src/app/directory/page.js').includes("useSearchParams().get('q')"));
    assert.ok(read('src/lib/ui/use-catalogue.js').includes('useCatalogue(initialSearch'));
    assert.ok(read('src/app/public/[id]/page.js').includes('router.push(DIRECTORY_PATH)'));
  });
  it('directoryHref carries the trimmed, encoded search, or none', () => {
    assert.equal(directoryHref(''), '/directory');
    assert.equal(directoryHref('   '), '/directory');
    assert.equal(directoryHref('  id card & clearance '), '/directory?q=id%20card%20%26%20clearance');
  });
  it('has no duration bar under the standard', () => {
    assert.ok(!dir.includes('DurationBar') && !dir.includes('lengthRank'));
    assert.ok(!dir.includes('The bar compares'));
  });
  it('has no sidebar: a cream page with a text Back link to the landing page, and the office filter is a select next to the search', () => {
    assert.ok(!dir.includes('Sidebar') && !dir.includes('Background.png') && !dir.includes('BrandMark'));
    assert.ok(dir.includes("const CREAM = '#F8F5F0'"));
    assert.ok(dir.includes('<Link href="/"') && dir.includes('&larr;</span> Back'));
    assert.ok(dir.includes('id="public-office"') && dir.includes('All offices ({counts.total})'));
  });
  it('the search, the three time filters with A-Z, the numbered rows, View requirements and the pager are all there', () => {
    assert.ok(dir.includes('placeholder="Search by service or office name"'));
    assert.ok(dir.includes('TIME_FILTERS.map'));
    assert.ok(dir.includes('sequenceLabel(number)'));
    assert.ok(dir.includes('View requirements'));
    assert.ok(dir.includes('<Pager page={current} pageSize={pageSize} total={total}'));
  });
  it('View requirements opens the existing public detail in a modal, and nothing is hardcoded', () => {
    assert.ok(dir.includes('PublicServiceView') && dir.includes('PUBLIC_SERVICES_API'));
    assert.ok(!/\d+ working days|Application for|Campus /.test(dir));
  });
});

describe('service listing typography (source checks, not a browser)', () => {
  const dir = read('src/components/public/PublicDirectory.js');
  it('the service name uses the sans font, like the office name under it (the global h3 style would make it serif)', () => {
    assert.ok(dir.includes('<h3 className="break-words font-sans text-base font-bold leading-snug"'));
    assert.ok(!dir.includes('font-serif text-base'));
  });
});

describe('search and pagination match the rest of CCMS (source checks, not a browser)', () => {
  const dir = read('src/components/public/PublicDirectory.js');
  it('the search is the Services-style field (label, icon inside the input, Search button) on the page background, not in a white card', () => {
    assert.ok(!dir.includes('rounded-2xl border border-[#EAE3D9] bg-white p-5 sm:p-6'), 'no white card behind it');
    assert.ok(dir.includes('<div className="flex flex-wrap items-end gap-3">'));
    assert.ok(dir.includes('<div className="w-full min-w-0 sm:w-80">'), 'same width as the Services search');
    assert.ok(dir.includes('<label className="label" htmlFor="public-search">Search</label>'));
    assert.ok(dir.includes('className="input pl-9"'));
    assert.ok(dir.includes('<button type="submit" className="btn-secondary w-full sm:w-auto">Search</button>'));
    assert.ok(dir.includes('placeholder="Search by service or office name"'));
  });
  it('pagination is the shared Pager (Items per page, arrows, maroon current page) on the page background, with a page-size change going back to page 1', () => {
    assert.ok(dir.includes("import Pager from '../navigation/Pager.js'"));
    assert.ok(!dir.includes('table-shell'), 'no white box around it');
    assert.ok(dir.includes('className="border-t-0! px-0!"'), 'no top line and no side padding, so it sits on the page background');
    assert.ok(dir.includes('onPageSizeChange={changePageSize}'));
    assert.ok(dir.includes('setPageSize(size);\n    setPage(1);'));
    assert.ok(!dir.includes('aria-label="Pagination"'), 'the old custom pager is gone');
  });
});
