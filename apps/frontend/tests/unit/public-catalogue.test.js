import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { fetchPublicServicesPage, listAllPublicServices } from '../../src/lib/api/public-services.js';
import { CLASSIFICATION_FILTERS, FETCH_PAGE_SIZE, PUBLIC_PAGE_SIZE, classificationFilterLabel, clampPage, filterServices, hasNarrowing, loadAllServices, normalizeView, officeOptions, pageCount, pageOf } from '../../src/lib/ui/public-catalogue.js';

// MOCKED fetchers shaped like the public API (Core public-catalogue.js): { items, page, page_size, total }, A to Z by name.
const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const svc = (n, classification = 'SIMPLE', office = 'Campus Administrative Office') => ({ service_id: `id-${n}`, service_name: `Service ${String(n).padStart(3, '0')}`, office_name: office, classification, standard_text: '5 minutes' });
const SERVICES = [
  ...Array.from({ length: 30 }, (_, i) => svc(i + 1, 'SIMPLE', 'Campus Administrative Office')),
  ...Array.from({ length: 20 }, (_, i) => svc(i + 31, 'COMPLEX', 'Campus Accounting Office')),
  ...Array.from({ length: 19 }, (_, i) => svc(i + 51, i % 2 ? 'HIGHLY_TECHNICAL' : 'SIMPLE', 'Campus Student Affairs and Services Office')),
];
const paged = (all) => async (page, size) => ({ items: all.slice((page - 1) * size, page * size), total: all.length });

describe('loading every page of the public services (MOCKED API)', () => {
  it('reads each page of 50 until the API\'s total is reached', async () => {
    const asked = [];
    const fetchPage = async (page, size) => { asked.push([page, size]); return paged(SERVICES)(page, size); };
    const { items, total, truncated } = await loadAllServices(fetchPage);
    assert.deepEqual(asked, [[1, 50], [2, 50]]);
    assert.equal(items.length, 69);
    assert.deepEqual([total, truncated], [69, false]);
    assert.equal(FETCH_PAGE_SIZE, 50);
  });
  it('handles an empty list and a single page', async () => {
    assert.deepEqual(await loadAllServices(paged([])), { items: [], total: 0, truncated: false });
    const one = await loadAllServices(paged(SERVICES.slice(0, 3)));
    assert.deepEqual([one.items.length, one.total], [3, 3]);
  });
  it('stops at the safety limit and says the list is incomplete', async () => {
    const forever = async (page) => ({ items: [svc(page)], total: 1000 });
    const r = await loadAllServices(forever, { maxPages: 3 });
    assert.deepEqual([r.items.length, r.truncated], [3, true]);
  });
  it('stops on an empty page even when the total says more (a changed list)', async () => {
    const r = await loadAllServices(async (page) => (page === 1 ? { items: [svc(1)], total: 5 } : { items: [], total: 5 }));
    assert.equal(r.items.length, 1);
  });
  it('lets a failure through, for the page to show', async () => {
    await assert.rejects(loadAllServices(async () => { throw Object.assign(new Error('Cannot reach the server.'), { status: 0 }); }), /Cannot reach/);
  });
});

describe('the public API requests (MOCKED fetcher)', () => {
  it('sends only search, page and page_size: the only parameters the API has', async () => {
    const urls = [];
    await fetchPublicServicesPage('dental', 2, 50, async (url) => (urls.push(url), {}));
    await fetchPublicServicesPage('', 1, 50, async (url) => (urls.push(url), {}));
    assert.deepEqual(urls, ['/api/catalogue/public/services?search=dental&page=2&page_size=50', '/api/catalogue/public/services?page=1&page_size=50']);
  });
  it('reads every page for a search', async () => {
    const urls = [];
    const fetcher = async (url) => { urls.push(url); const page = Number(new URL(url, 'http://x').searchParams.get('page')); return { items: SERVICES.slice((page - 1) * 50, page * 50), total: 69 }; };
    const all = await listAllPublicServices('campus', fetcher);
    assert.equal(all.items.length, 69);
    assert.equal(urls.length, 2);
    assert.ok(urls.every((u) => u.includes('search=campus')));
    for (const u of urls) for (const key of new URL(u, 'http://x').searchParams.keys()) assert.ok(['search', 'page', 'page_size'].includes(key), key);
  });
});

describe('office list, classification filter and paging', () => {
  it('lists the real offices once each, A to Z, and keeps a selected office', () => {
    assert.deepEqual(officeOptions(SERVICES), ['Campus Accounting Office', 'Campus Administrative Office', 'Campus Student Affairs and Services Office']);
    assert.deepEqual(officeOptions([svc(1)], 'Campus Zoology Office'), ['Campus Administrative Office', 'Campus Zoology Office']);
    assert.deepEqual(officeOptions([]), []);
  });
  it('filters by classification and office, keeping the order, and "all" means no filter', () => {
    assert.equal(filterServices(SERVICES, {}).length, 69);
    assert.equal(filterServices(SERVICES, { classification: 'COMPLEX' }).length, 20);
    assert.equal(filterServices(SERVICES, { classification: 'SIMPLE' }).length, 40);
    assert.equal(filterServices(SERVICES, { classification: 'HIGHLY_TECHNICAL' }).length, 9);
    assert.equal(filterServices(SERVICES, { office: 'Campus Accounting Office' }).length, 20);
    assert.equal(filterServices(SERVICES, { classification: 'SIMPLE', office: 'Campus Student Affairs and Services Office' }).length, 10);
    assert.equal(filterServices(SERVICES, { classification: 'COMPLEX', office: 'Campus Administrative Office' }).length, 0);
    const names = filterServices(SERVICES, { classification: 'COMPLEX' }).map((s) => s.service_name);
    assert.deepEqual(names, [...names].sort());
  });
  it('offers All, Simple, Complex and Highly technical, and nothing else', () => {
    assert.deepEqual(CLASSIFICATION_FILTERS.map((c) => c.label), ['All', 'Simple', 'Complex', 'Highly technical']);
    assert.deepEqual(CLASSIFICATION_FILTERS.map((c) => c.value), ['', 'SIMPLE', 'COMPLEX', 'HIGHLY_TECHNICAL']);
    assert.equal(classificationFilterLabel('HIGHLY_TECHNICAL'), 'Highly technical');
  });
  it('counts and pages the filtered list (12 per page)', () => {
    assert.equal(PUBLIC_PAGE_SIZE, 12);
    assert.equal(pageCount(69), 6);
    assert.equal(pageCount(0), 1);
    assert.equal(pageCount(12), 1);
    assert.equal(pageCount(13), 2);
    assert.equal(pageOf(SERVICES, 1).length, 12);
    assert.equal(pageOf(SERVICES, 6).length, 9);
    assert.equal(pageOf(SERVICES, 6)[0].service_name, 'Service 061');
    assert.deepEqual(pageOf([], 1), []);
  });
  it('a page that no longer exists falls back to one that does (for example after a filter shrinks the list)', () => {
    assert.equal(clampPage(6, 20), 2);
    assert.equal(clampPage(0, 20), 1);
    assert.equal(clampPage(3.5, 100), 1);
    assert.equal(clampPage(5, 0), 1);
    assert.equal(pageOf(filterServices(SERVICES, { classification: 'COMPLEX' }), 6).length, 8);
  });
  it('tells when a classification or office narrows the list', () => {
    assert.equal(hasNarrowing({}), false);
    assert.equal(hasNarrowing({ classification: 'SIMPLE' }), true);
    assert.equal(hasNarrowing({ office: 'X' }), true);
  });
  it('knows the two views and falls back to the grid', () => {
    assert.equal(normalizeView('list'), 'list');
    assert.equal(normalizeView('grid'), 'grid');
    assert.equal(normalizeView('table'), 'grid');
    assert.equal(normalizeView(undefined), 'grid');
  });
});

describe('the screen (source checks)', () => {
  const page = strip(read('src/app/page.js') + read('src/lib/ui/use-catalogue.js')); // the page and the shared catalogue hook it uses
  it('uses one list for both views, so switching the view changes nothing but the layout', () => {
    assert.ok(/const \[view, setView\] = useState\('grid'\)/.test(page));
    assert.ok(/<ViewToggle view=\{view\} onView=\{setView\}/.test(page));
    // The view is never part of the data load or of what resets the page.
    assert.ok(/\}, \[search, attempt\]\);/.test(page));
    assert.ok(!/setView\([^)]*\);\s*setPage\(1\)/.test(page));
  });
  it('starts again at page 1 on a search, a classification or an office, but not on a view change', () => {
    assert.ok(/const chooseClassification = \(value\) => \{ setClassification\(value\); setPage\(1\); \};/.test(page));
    assert.ok(/const chooseOffice = \(value\) => \{ setOffice\(value\); setPage\(1\); \};/.test(page));
    assert.ok(/setPage\(1\);\s*setSearch\(input\.trim\(\)\);/.test(page));
  });
  it('throws away an answer for an older search', () => {
    assert.ok(/const id = \+\+latest\.current;/.test(page));
    assert.ok((page.match(/if \(id === latest\.current\)/g) ?? []).length === 2);
  });
  it('has accessible Grid and List buttons and pill filters', () => {
    assert.ok(/aria-pressed=\{selected\}/.test(page));
    assert.ok(/aria-label=\{`\$\{label\} view`\}/.test(page));
    assert.ok(/role="group" aria-label="Services view"/.test(page));
    assert.ok(/role="group" aria-label="Classification"/.test(page));
  });
  it('links each service to its existing public detail page and Staff Login to the existing login route', () => {
    assert.ok(/`\/public\/\$\{encodeURIComponent\(item\.service_id\)\}`/.test(page));
    assert.ok(read('src/components/public/LandingHero.js').includes('href="/login"'), 'the landing page has Staff Login');
    assert.ok(strip(read('src/components/layout/PublicHeader.js')).includes('href="/login"'));
  });
  it('shows no hardcoded service data, counts or processing times', () => {
    assert.ok(!/\b69\b/.test(page));
    assert.ok(!/\d+ minutes|\d+ working days/.test(page));
    assert.ok(/item\.standard_text/.test(page));
  });
});
