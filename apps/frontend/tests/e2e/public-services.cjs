// Browser test for the public services page: Grid and List views, search, classification and office filters, paging.
// A plain Playwright script like smoke.cjs (no test runner). It needs only the frontend at BASE_URL (npm run dev). The public API
// (/api/catalogue/public/services) is MOCKED with a page route that behaves like the real one (search over service and office name,
// page / page_size up to 50, A to Z); nothing real is read or written and no login is involved. Any other /api call fails the run.
//
// Run:  node tests/e2e/public-services.cjs
const { chromium } = require('playwright');
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const ok = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) process.exitCode = 1; };
const json = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const OFFICES = ['Campus Accounting Office', 'Campus Administrative Office', 'Campus Student Affairs and Services Office'];
const LONG = 'Consultation and Treatment Services for Emergency Medical Cases of Faculty and Administrative Employees (Without Referral) with a deliberately very long additional description to prove that wrapping works';
// 30 services; the API returns them A to Z by name.
const SERVICES = Array.from({ length: 30 }, (_, i) => {
  const n = i + 1;
  return {
    service_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    service_name: n === 7 ? LONG : `Service ${String(n).padStart(2, '0')}`,
    office_name: OFFICES[n % 3],
    classification: ['SIMPLE', 'COMPLEX', 'HIGHLY_TECHNICAL'][n % 3 === 0 ? 0 : n % 3 === 1 ? 1 : 2],
    standard_text: n % 4 === 0 ? '2 working days, 23 minutes' : `${n} minutes`,
  };
}).sort((a, b) => a.service_name.toLowerCase().localeCompare(b.service_name.toLowerCase()));
const count = (pred) => SERVICES.filter(pred).length;

async function open(browser, { w = 1300, h = 1400, handler } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const log = { requests: [], unmocked: [] };
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/api/catalogue/public/services') {
      log.requests.push(u.searchParams);
      if (handler) return handler(r, u.searchParams);
      const search = (u.searchParams.get('search') ?? '').toLowerCase();
      const all = SERVICES.filter((s) => !search || s.service_name.toLowerCase().includes(search) || s.office_name.toLowerCase().includes(search));
      const size = Math.min(Number(u.searchParams.get('page_size') || 12), 50);
      const page = Number(u.searchParams.get('page') || 1);
      return json(r, 200, { items: all.slice((page - 1) * size, page * size), page, page_size: size, total: all.length });
    }
    log.unmocked.push(u.pathname);
    return json(r, 401, { error: { code: 'UNAUTHORIZED', message: 'x' } });
  });
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 90000 });
  await page.getByTestId('service-count').waitFor({ timeout: 60000 });
  return { page, ctx, log };
}
const rows = (page) => page.locator('[data-testid=service-grid] > li, [data-testid=service-list] > li');
const names = (page) => page.locator('[data-testid=service-grid] h3, [data-testid=service-list] h3').allInnerTexts();
const toggle = (page, name) => page.getByRole('button', { name: `${name} view`, exact: true });
const pill = (page, name) => page.getByRole('group', { name: 'Classification' }).getByRole('button', { name, exact: true });
// The standard pager ("Items per page", Previous, the current page, Next) announces its range to screen readers.
const pager = (page) => page.locator('main').getByText(/^Showing \d+ to \d+ of \d+$/);
const pageLabel = (page) => page.locator('main nav[aria-label="Pagination"] [aria-current=page]').getAttribute('aria-label');

(async () => {
  const browser = await chromium.launch();

  // Grid view: the public page.
  {
    const { page, ctx, log } = await open(browser);
    ok('hero: the heading, supporting text, search box and Search button are there', /Find a service\. Know what to bring and how long it takes\./.test(await page.locator('h1').innerText()) && (await page.getByText(/Search the Citizen.s Charter of/).count()) === 1 && (await page.locator('#public-search').count()) === 1 && (await page.getByRole('button', { name: 'Search', exact: true }).count()) === 1);
    ok('hero: the PUP Quezon City CCMS brand and a Staff Login link to the login page', (await page.locator('header').getByText('CCMS').count()) >= 1 && (await page.locator('header').getByRole('link', { name: 'Staff Login' }).getAttribute('href')) === '/login');
    const tiles = await page.getByRole('region', { name: 'Quick links' }).locator('button').allInnerTexts();
    ok('three feature cards: Browse all services, Find by office, What to bring', tiles.length === 3 && /Browse all services/.test(tiles[0]) && /Find by office/.test(tiles[1]) && /What to bring/.test(tiles[2]));
    ok('catalog: "All services" with the count from the API (not a fixed number)', (await page.locator('#services h2').innerText()) === 'All services' && (await page.getByTestId('service-count').innerText()).trim() === `Showing ${SERVICES.length} services`);
    ok('grid is the default view, with 12 cards on the first page', (await toggle(page, 'Grid').getAttribute('aria-pressed')) === 'true' && (await toggle(page, 'List').getAttribute('aria-pressed')) === 'false' && (await rows(page).count()) === 12 && (await page.getByTestId('service-grid').count()) === 1);
    const card = await rows(page).first().innerText();
    ok('a card shows the classification badge, the service name, the office, the standard time and View requirements', /Simple|Complex|Highly Technical/.test(card) && /Service|Consultation/.test(card) && /Campus .* Office/.test(card) && /STANDARD/i.test(card) && /View requirements/.test(card));
    ok('the filter panel (classification pills and the office dropdown) is under the heading in Grid view too, and the view toggle is at the right of the heading', await page.evaluate(() => {
      const h = document.querySelector('#services h2').getBoundingClientRect();
      const t = document.querySelector('[aria-label="Services view"]').getBoundingClientRect();
      const s = document.querySelector('#office-filter').getBoundingClientRect();
      const pills = document.querySelector('[aria-label="Classification"]').getBoundingClientRect();
      return t.left > h.right && s.top > h.bottom && pills.top > h.bottom && s.left > pills.left;
    }));
    ok('the pager shows the item range and total, Previous disabled on page 1', (await pager(page).innerText()) === `Showing 1 to 12 of ${SERVICES.length}` && (await page.getByRole('button', { name: 'Previous page' }).isDisabled()) && !(await page.getByRole('button', { name: 'Next page' }).isDisabled()));
    ok('only the public API was called, with search/page/page_size only, and never more than 50 per page', log.unmocked.every((p) => /\/api\/identity\//.test(p)) && log.requests.length >= 1 && log.requests.every((q) => [...q.keys()].every((k) => ['search', 'page', 'page_size'].includes(k)) && Number(q.get('page_size')) <= 50));
    await page.screenshot({ path: `${process.env.OUT_DIR || '.'}/public-grid.png`, fullPage: true }).catch(() => {});
    await ctx.close();
  }

  // Details link.
  {
    const { page, ctx } = await open(browser);
    const first = SERVICES[0];
    const href = await rows(page).first().getByRole('link', { name: /View requirements/ }).getAttribute('href');
    ok('View requirements opens the service\'s existing public detail page', href === `/public/${first.service_id}`);
    await ctx.close();
  }

  // Switch to List: structure, and nothing is lost.
  {
    const { page, ctx } = await open(browser);
    await toggle(page, 'List').click();
    ok('List view: the toggle shows List selected (deep maroon, white text), and rows replace cards', (await toggle(page, 'List').getAttribute('aria-pressed')) === 'true' && (await page.getByTestId('service-list').count()) === 1 && (await page.getByTestId('service-grid').count()) === 0 && (await rows(page).count()) === 12);
    await page.waitForTimeout(500); // the button fades to its selected colours
    const colors = await toggle(page, 'List').evaluate((e) => {
      const probe = (cls) => { const x = document.createElement('span'); x.className = cls; document.body.appendChild(x); const s = getComputedStyle(x); const out = { bg: s.backgroundColor, color: s.color }; x.remove(); return out; };
      const s = getComputedStyle(e);
      return { bg: s.backgroundColor, fg: s.color, maroon: probe('bg-maroon-900').bg, white: probe('text-white').color };
    });
    ok('the selected toggle is the deep maroon with white text', colors.bg === colors.maroon && colors.fg === colors.white);
    ok('List view: a filter panel with All, Simple, Complex and Highly technical pills and the office dropdown', (await page.getByRole('group', { name: 'Classification' }).getByRole('button').allInnerTexts()).join('|') === 'All|Simple|Complex|Highly technical' && (await pill(page, 'All').getAttribute('aria-pressed')) === 'true' && (await page.locator('#office-filter option').count()) === OFFICES.length + 1);
    const row = await rows(page).first().innerText();
    ok('a row shows name, office, badge, standard time and a View requirements button', /Campus .* Office/.test(row) && /STANDARD/i.test(row) && /View requirements/.test(row));
    ok('a row has a narrow maroon accent on its left edge', await rows(page).first().evaluate((e) => { const s = getComputedStyle(e); return s.borderLeftWidth === '4px' && s.borderLeftColor !== s.borderTopColor; }));
    ok('the View toggle is on the right of the heading row', await page.evaluate(() => { const h = document.querySelector('#services h2').getBoundingClientRect(); const t = document.querySelector('[aria-label="Services view"]').getBoundingClientRect(); return t.left > h.right; }));
    await page.screenshot({ path: `${process.env.OUT_DIR || '.'}/public-list.png`, fullPage: true }).catch(() => {});
    await ctx.close();
  }

  // Classification and office filters, page reset, and view switching keeps everything.
  {
    const { page, ctx } = await open(browser);
    await toggle(page, 'List').click();
    await pill(page, 'Complex').click();
    const complex = count((s) => s.classification === 'COMPLEX');
    await page.waitForFunction((n) => /Showing (\d+) services/.test(document.querySelector('[data-testid=service-count]').textContent) && document.querySelector('[data-testid=service-count]').textContent.includes(`Showing ${n} `), complex);
    ok('Complex: the count and the rows are only Complex services, and the pill is the selected one', (await pill(page, 'Complex').getAttribute('aria-pressed')) === 'true' && (await pill(page, 'All').getAttribute('aria-pressed')) === 'false' && (await rows(page).count()) === Math.min(12, complex) && (await rows(page).allInnerTexts()).every((t) => /Complex/.test(t)));
    ok('the pager follows the filtered total', (await pager(page).innerText()) === `Showing 1 to ${Math.min(12, complex)} of ${complex}`);
    await page.locator('#office-filter').selectOption(OFFICES[1]);
    const both = count((s) => s.classification === 'COMPLEX' && s.office_name === OFFICES[1]);
    await page.waitForFunction((n) => document.querySelector('[data-testid=service-count]').textContent.includes(`Showing ${n} `), both);
    ok('Complex + one office narrows to both filters together', (await rows(page).allInnerTexts()).every((t) => /Complex/.test(t) && t.includes(OFFICES[1])));
    await toggle(page, 'Grid').click();
    ok('switching to Grid keeps the classification, the office and the results (selected pill + office select + same rows)', (await pill(page, 'Complex').getAttribute('aria-pressed')) === 'true' && (await page.locator('#office-filter').inputValue()) === OFFICES[1] && (await page.getByTestId('service-count').innerText()).includes(`Showing ${both} `) && (await rows(page).count()) === Math.min(12, both));
    await toggle(page, 'List').click();
    ok('and back to List again, still the same filters', (await pill(page, 'Complex').getAttribute('aria-pressed')) === 'true' && (await page.locator('#office-filter').inputValue()) === OFFICES[1]);
    await pill(page, 'All').click();
    await page.locator('#office-filter').selectOption('');
    await page.waitForFunction((n) => document.querySelector('[data-testid=service-count]').textContent.includes(`Showing ${n} `), SERVICES.length);
    ok('clearing the filters restores every service', (await rows(page).count()) === 12);
    await ctx.close();
  }

  // Paging keeps filters; filter change resets the page; view change keeps the page.
  {
    const { page, ctx } = await open(browser);
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.waitForFunction(() => /Showing 13 to 24/.test(document.querySelector('main').innerText));
    ok('Next goes to page 2 (13-24) and shows Page 2 of 3', (await pageLabel(page)) === 'Page 2 of 3');
    await toggle(page, 'List').click();
    ok('switching view on page 2 stays on page 2', /Showing 13 to 24 of 30/.test(await page.locator('main').innerText()) && (await rows(page).count()) === 12);
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.waitForFunction(() => /Showing 25 to 30/.test(document.querySelector('main').innerText));
    ok('the last page has 6 rows and Next is disabled', (await rows(page).count()) === 6 && (await page.getByRole('button', { name: 'Next page' }).isDisabled()));
    await pill(page, 'Complex').click();
    await page.waitForFunction(() => /Showing 1 to 10 of 10/.test(document.querySelector('main').innerText));
    ok('choosing a classification on the last page starts again at page 1 of the filtered list', /Showing 1 to 10 of 10/.test(await page.locator('main').innerText()) && (await pageLabel(page)) === 'Page 1 of 1');
    ok('with a single page both pager buttons are disabled', (await page.getByRole('button', { name: 'Previous page' }).isDisabled()) && (await page.getByRole('button', { name: 'Next page' }).isDisabled()));
    await ctx.close();
  }
  {
    const { page, ctx } = await open(browser);
    await toggle(page, 'List').click();
    await pill(page, 'Simple').click();
    await page.getByRole('button', { name: 'Next page' }).waitFor();
    const simple = count((s) => s.classification === 'SIMPLE');
    await page.waitForFunction((n) => document.querySelector('[data-testid=service-count]').textContent.includes(`Showing ${n} `), simple);
    if (simple > 12) {
      await page.getByRole('button', { name: 'Next page' }).click();
      await page.waitForFunction(() => /Showing 13/.test(document.querySelector('main').innerText));
      ok('paging inside a filter keeps the filter and counts only the filtered rows', (await rows(page).allInnerTexts()).every((t) => /Simple/.test(t)) && (await pager(page).innerText()).endsWith(`of ${simple}`));
    }
    await ctx.close();
  }

  // The standard pager: Items per page, Previous, the current page in maroon, Next. Changing the size keeps the filters.
  {
    const { page, ctx } = await open(browser);
    const sizes = await page.getByLabel('Items per page').locator('option').allInnerTexts();
    ok('the pager is the standard one: Items per page 12/24/48/96, arrows and the current page number', sizes.join('|') === '12|24|48|96' && (await page.getByLabel('Items per page').inputValue()) === '12' && (await page.locator('main .table-pager').count()) === 1 && (await page.locator('main nav[aria-label="Pagination"] [aria-current=page]').innerText()) === '1');
    await toggle(page, 'List').click();
    await pill(page, 'Complex').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=service-count]').textContent.includes('Showing 10 '));
    await page.getByRole('button', { name: 'Next page' }).waitFor();
    await page.getByLabel('Items per page').selectOption('24');
    await page.getByLabel('Items per page').waitFor();
    ok('choosing 24 per page keeps the view and the classification, and starts at page 1', (await pill(page, 'Complex').getAttribute('aria-pressed')) === 'true' && (await page.getByTestId('service-list').count()) === 1 && (await pageLabel(page)) === 'Page 1 of 1');
    await pill(page, 'All').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=service-list] > li').length === 24);
    ok('and the larger size shows 24 rows with the next page still available', (await pageLabel(page)) === 'Page 1 of 2' && !(await page.getByRole('button', { name: 'Next page' }).isDisabled()));
    await ctx.close();
  }

  // Search by service name and by office name, page 1, stale answers.
  {
    const { page, ctx, log } = await open(browser);
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.waitForFunction(() => /Showing 13/.test(document.querySelector('main').innerText));
    await page.fill('#public-search', 'Service 1');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#services h2').textContent.includes('Results for'));
    const byName = SERVICES.filter((s) => s.service_name.toLowerCase().includes('service 1')).length;
    ok('search by service name: results heading, filtered count, back on page 1', (await page.locator('#services h2').innerText()) === 'Results for "Service 1"' && (await page.getByTestId('service-count').innerText()).includes(`Showing ${byName} `) && log.requests.some((q) => q.get('search') === 'Service 1'));
    await page.fill('#public-search', 'Accounting');
    await page.locator('#public-search').press('Enter');
    await page.waitForFunction(() => document.querySelector('#services h2').textContent.includes('Accounting'));
    const byOffice = SERVICES.filter((s) => s.office_name.includes('Accounting')).length;
    ok('search by office name works the same way', (await page.getByTestId('service-count').innerText()).includes(`Showing ${byOffice} `) && (await rows(page).allInnerTexts()).every((t) => t.includes('Accounting')));
    await toggle(page, 'List').click();
    ok('the search stays when the view changes', (await page.locator('#services h2').innerText()) === 'Results for "Accounting"' && (await page.locator('#public-search').inputValue()) === 'Accounting');
    await ctx.close();
  }
  {
    // The older (slow) search answers after the newer one: it must not win.
    const { page, ctx } = await open(browser, {
      handler: async (r, q) => {
        const search = q.get('search') ?? '';
        if (search === 'Slow') await new Promise((x) => setTimeout(x, 1500));
        const all = SERVICES.filter((s) => !search || s.service_name.includes(search === 'Slow' ? 'Service 0' : search));
        return json(r, 200, { items: all.slice(0, 50), page: 1, page_size: 50, total: all.length });
      },
    });
    await page.fill('#public-search', 'Slow');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.fill('#public-search', 'Service 30');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForTimeout(2600);
    ok('a slow answer for an older search cannot replace the newer search\'s results', (await page.locator('#services h2').innerText()) === 'Results for "Service 30"' && (await rows(page).count()) === 1);
    await ctx.close();
  }

  // Empty, error, loading.
  {
    const { page, ctx } = await open(browser);
    await page.fill('#public-search', 'zzzz-nothing');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByText('No services match "zzzz-nothing"').waitFor();
    ok('empty search: a clear message and a way back', (await page.getByRole('button', { name: 'Show all services' }).count()) === 1);
    await page.getByRole('button', { name: 'Show all services' }).click();
    await page.getByTestId('service-grid').waitFor();
    ok('Show all services restores the full list and empties the search', (await rows(page).count()) === 12 && (await page.locator('#public-search').inputValue()) === '');
    await toggle(page, 'List').click();
    await page.locator('#office-filter').selectOption(OFFICES[0]);
    await pill(page, 'Highly technical').click();
    await page.getByText('No services match these filters').waitFor();
    ok('filters that match nothing: a message and Clear filters', (await page.getByRole('button', { name: 'Clear filters' }).count()) === 1 && (await page.getByTestId('service-count').innerText()).includes('Showing 0 services'));
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=service-list] > li').length === 12);
    ok('Clear filters returns every service', (await pill(page, 'All').getAttribute('aria-pressed')) === 'true');
    await ctx.close();
  }
  {
    const { page, ctx } = await open(browser, { handler: (r) => json(r, 200, { items: [], page: 1, page_size: 50, total: 0 }) });
    await page.getByText('No services are published yet').waitFor();
    ok('no services at all: the "not published yet" message', true);
    await ctx.close();
  }
  {
    let fail = true;
    // The page must also load when the first request fails: open it by hand.
    const ctx2 = await browser.newContext({ viewport: { width: 1300, height: 1200 } });
    const p2 = await ctx2.newPage();
    await p2.route('**/api/**', (r) => (fail ? r.abort('connectionrefused') : json(r, 200, { items: SERVICES.slice(0, 12), page: 1, page_size: 50, total: 12 })));
    await p2.goto(BASE + '/', { waitUntil: 'load', timeout: 90000 });
    await p2.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 60000 });
    ok('API failure: a readable message, no cards, and Try again', /Cannot reach the server/.test(await p2.locator('main').innerText()) && (await p2.locator('[data-testid=service-grid] li').count()) === 0);
    fail = false;
    await p2.getByRole('button', { name: 'Try again' }).click();
    await p2.getByTestId('service-grid').waitFor({ timeout: 30000 });
    ok('Try again loads the services', (await p2.locator('[data-testid=service-grid] > li').count()) === 12);
    await ctx2.close();
  }
  // Long names, and the layouts at tablet and phone sizes.
  for (const [name, w, h] of [['desktop 1300', 1300, 1200], ['tablet 820', 820, 1200], ['mobile 390', 390, 900]]) {
    for (const view of ['Grid', 'List']) {
      const { page, ctx } = await open(browser, { w, h });
      if (view === 'List') await toggle(page, 'List').click();
      await page.fill('#public-search', 'deliberately very long');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#services h2').textContent.includes('Results for'));
      const fits = await page.evaluate(() => {
        const items = [...document.querySelectorAll('[data-testid=service-grid] > li, [data-testid=service-list] > li')];
        return document.documentElement.scrollWidth <= window.innerWidth && items.length > 0 && items.every((li) => li.getBoundingClientRect().right <= window.innerWidth + 1 && li.scrollWidth <= li.clientWidth + 1);
      });
      ok(`${name}, ${view}: a very long service name wraps inside its ${view === 'Grid' ? 'card' : 'row'} with no sideways scrolling`, fits && (await names(page))[0].includes('deliberately very long'));
      if (w === 390 && view === 'List') {
        await page.fill('#public-search', '');
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('[data-testid=service-list] > li').length === 12);
        const stacked = await page.evaluate(() => { const li = document.querySelector('[data-testid=service-list] > li'); const a = li.querySelector('a').getBoundingClientRect(); const h = li.querySelector('h3').getBoundingClientRect(); return a.top >= h.bottom && a.right <= window.innerWidth && a.width > 200; });
        ok('mobile, List: the row stacks and View requirements is a full-width, reachable button', stacked);
        await page.screenshot({ path: `${process.env.OUT_DIR || '.'}/public-list-mobile.png` }).catch(() => {});
      }
      if (w === 820) {
        const cols = await page.evaluate(() => { const g = document.querySelector('[data-testid=service-grid]'); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0; });
        if (view === 'Grid') ok('tablet, Grid: two columns', cols === 2);
      }
      if (w === 1300 && view === 'Grid') {
        await page.fill('#public-search', '');
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('[data-testid=service-grid] > li').length === 12);
        ok('desktop, Grid: three columns', (await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=service-grid]')).gridTemplateColumns.split(' ').length)) === 3);
      }
      if (w === 390 && view === 'Grid') {
        await page.fill('#public-search', '');
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('[data-testid=service-grid] > li').length === 12);
        ok('mobile, Grid: one column', (await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=service-grid]')).gridTemplateColumns.split(' ').length)) === 1);
      }
      await ctx.close();
    }
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
