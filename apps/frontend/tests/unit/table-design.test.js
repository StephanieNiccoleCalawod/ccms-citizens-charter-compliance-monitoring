import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// Source-level checks (not a browser): every CCMS table and its pagination come from the shared components and
// the shared tokens in globals.css, so no page can drift into its own colours, borders or footer.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const sources = walk(join(ROOT, 'src')).filter((f) => f.endsWith('.js'));
const rel = (f) => relative(ROOT, f).replaceAll('\\', '/');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const css = read('src/app/globals.css');

const TABLE_PAGES = {
  'src/app/accounts/page.js': ['Name', 'Position', 'Email', 'Role', 'Office', 'Status', 'Actions'],
  'src/app/offices/page.js': ['Office name', 'Status', 'Actions'],
  'src/app/logs/page.js': ['Date &amp; time', 'Done by', 'Action', 'Affected entity', 'Office'],
  'src/app/calendar/Terms.js': ['Term', 'Start date', 'End date'],
  'src/app/settings/connected-systems/SyncPanel.js': ['External system', 'Event', 'Status', 'Last synced', 'Attempts'],
  'src/app/settings/Counters.js': ['Counter', 'Status', 'Actions'],
};

describe('the shared design tokens', () => {
  it('define the shared palette once: page, line, table header and row hover', () => {
    assert.match(css, /--color-page:\s*#F4F5F8;/i);
    assert.match(css, /--color-line:\s*#E2E8F0;/i);
    assert.match(css, /--color-table-head:\s*#800000;/i);
    assert.match(css, /--color-table-hover:\s*rgba\(128, 0, 0, 0\.04\);/i);
  });

  it('the table container uses shared border and shadow tokens, is white, rounded and clips its children', () => {
    const shell = /@utility table-shell \{\s*@apply ([^;]+);/.exec(css)[1];
    for (const token of ['overflow-hidden', 'rounded-xl', 'border', 'border-line', 'bg-white']) assert.ok(shell.split(/\s+/).includes(token), token);
    assert.ok(shell.split(/\s+/).includes('shadow-card'));
  });

  it('the header is the burgundy token with small bold uppercase white labels and no lines between the columns', () => {
    assert.match(css, /@utility table-head \{\s*@apply bg-table-head;/);
    const th = /@utility th \{\s*@apply ([^;]+);/.exec(css)[1];
    for (const token of ['text-[11px]', 'font-bold', 'uppercase', 'text-white']) assert.ok(th.split(/\s+/).includes(token), token);
    assert.doesNotMatch(th, /border/, 'header cells have no borders, so no white lines show between the columns');
  });

  it('rows are about 52px with the shared hover, and cells share one padding and text size', () => {
    assert.match(css, /@utility tr-row \{\s*@apply h-\[52px\][^;]*hover:bg-table-hover;/);
    assert.match(css, /@utility td \{\s*@apply px-4 py-2\.5 align-middle text-xs/);
  });

  it('icon buttons in rows share one size, border and radius; the pagination uses the maroon page marker and muted arrows', () => {
    assert.match(css, /@utility row-icon-button \{\s*@apply inline-flex h-7 w-7[^;]*rounded-lg border border-line bg-white/);
    assert.match(css, /@utility page-current \{[^}]*bg-pup-maroon[^}]*text-white/);
    assert.match(css, /@utility page-arrow \{[^}]*text-slate-500[^}]*disabled:text-slate-300/);
    assert.match(css, /@utility table-pager \{[^}]*border-t/);
  });

  it('the content area uses the shared page background; no page sets its own', () => {
    assert.match(read('src/components/layout/AppShell.js'), /min-h-screen bg-page md:flex/);
    for (const file of sources.filter((f) => rel(f).startsWith('src/app/') && !rel(f).endsWith('globals.css'))) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /bg-\[#F7F3EE\]|pageClassName=/i, rel(file));
    }
  });
});

describe('every table is built from the shared components', () => {
  it('only TableShell.js writes a <table>, <thead> or <th>', () => {
    for (const file of sources) {
      const name = rel(file);
      if (name === 'src/components/ui/TableShell.js') continue;
      assert.doesNotMatch(readFileSync(file, 'utf8'), /<table[\s>]|<thead[\s>]|<th[\s>]/, name);
    }
    const shell = read('src/components/ui/TableShell.js');
    assert.match(shell, /<table[\s>]/);
    assert.match(shell, /<thead className="table-head">/);
    assert.match(shell, /className="relative overflow-x-auto"/, 'the scroll box is positioned so hidden header labels cannot widen the page');
    assert.match(shell, /className=\{`th /);
  });

  it('no page or component picks its own header colour, container border or row divider', () => {
    for (const file of sources) {
      const name = rel(file);
      if (name === 'src/components/ui/TableShell.js') continue;
      const text = readFileSync(file, 'utf8');
      // No header background of its own, and none of the older table classes or the old row divider.
      assert.doesNotMatch(text, /<thead[^>]*bg-/, name);
      assert.doesNotMatch(text, /table-card|className="table-head"|divide-slate-200/, name);
    }
  });

  for (const [file, headings] of Object.entries(TABLE_PAGES)) {
    it(`${file}: uses TableShell and Table, keeps its columns and styles its rows with tr-row`, () => {
      const text = read(file);
      assert.match(text, /import TableShell, \{ Table, Th \} from '(\.\.\/)+components\/ui\/TableShell\.js';/);
      assert.match(text, /<TableShell[\s>]/);
      assert.match(text, /<Table[\s\n]/);
      for (const heading of headings) assert.ok(text.includes(`>${heading}</Th>`) || text.includes(`>${heading}</Th`), `${file} lost the "${heading}" column`);
      assert.match(text, /className=(\{`)?"?tr-row/);
    });
  }

  it('the Service Catalogue table (DataTable) is the same shared table, with the same row class', () => {
    const text = read('src/components/ui/DataTable.js');
    assert.match(text, /<TableShell /);
    assert.match(text, /<Table\b/);
    assert.match(text, /tr-row/);
    assert.match(read('src/app/services/page.js'), /<DataTable/);
  });

  it('a table never gets its own shadow or border colour from the page', () => {
    for (const file of Object.keys(TABLE_PAGES)) {
      const shellTag = [...read(file).matchAll(/<TableShell[^>]*>/g)].map((m) => m[0]).join('');
      assert.doesNotMatch(shellTag, /shadow|border-|bg-/, file);
    }
  });
});

describe('pagination is the one shared Pager', () => {
  const pager = read('src/components/navigation/Pager.js');

  it('the standard layout is "Items per page" on the left, Previous, the current page and Next on the right', () => {
    assert.doesNotMatch(pager, /variant/, 'there is one layout, no variants');
    assert.match(pager, /Items per page:/);
    assert.match(pager, /aria-label="Items per page"/);
    assert.match(pager, /aria-label="Previous page"/);
    assert.match(pager, /aria-label="Next page"/);
    assert.match(pager, /className="page-current"/);
    assert.match(pager, /aria-current="page"/);
    assert.match(pager, /disabled=\{page <= 1 \|\| loading\}/);
    assert.match(pager, /disabled=\{page >= pages \|\| loading\}/);
    assert.match(pager, /table-pager/);
  });

  it('counts come from the props, never from fixed numbers, and a total of 0 draws nothing', () => {
    assert.match(pager, /const pages = Math\.max\(1, Math\.ceil\(total \/ pageSize\)\);\s*if \(total === 0\) return null;/);
    const code = pager.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /Page 1 of 1|Showing 1/);
  });

  it('the page size on screen is always one of the choices', () => {
    assert.match(pager, /pageSizeOptions\.includes\(pageSize\)/);
    assert.match(pager, /DEFAULT_PAGE_SIZES = \[10, 20, 50, 100\]/);
  });

  it('the three server-paged tables use it with a page-size choice, ask the service for the chosen size, and start again at page 1', () => {
    for (const file of ['src/app/accounts/page.js', 'src/app/logs/page.js', 'src/app/services/page.js']) {
      const text = read(file);
      assert.match(text, /const \[pageSize, setPageSize\] = useState\(/, file);
      assert.match(text, /onPageSizeChange[=:] ?\{?changePageSize\}?/, file);
      assert.match(text, /function changePageSize\(\w+\)|changePageSize = /, file);
      if (file === 'src/app/logs/page.js') assert.doesNotMatch(text, /\.slice\(\s*\(page - 1\)/, `${file} must not page on the client`);
      else assert.ok(text.includes('pageSlice('), `${file} pages its newest-first list here`);
    }
    // CC046 moved the accounts query into accountsParams (lib/ui/account-position.js): the chosen size still goes out as page_size.
    assert.match(read('src/app/accounts/page.js'), /accountsParams\(\{ page: pageNo, pageSize: size,/);
    assert.match(read('src/lib/ui/account-position.js'), /page_size: String\(pageSize\)/);
    assert.match(read('src/app/services/page.js'), /page_size: size/);
    assert.match(read('src/app/accounts/page.js'), /setPageSize\(size\);\s*setPage\(1\);/);
    assert.match(read('src/app/services/page.js'), /setPageSize\(size\);\s*setPage\(1\);/);
  });

  it('keeps each module\'s own default size (Accounts 10, Services 20, Logs 10)', () => {
    assert.match(read('src/app/accounts/page.js'), /const DEFAULT_PAGE_SIZE = 10;/);
    assert.match(read('src/app/services/page.js'), /const DEFAULT_PAGE_SIZE = 20;/);
    assert.match(read('src/app/logs/page.js'), /useState\(10\)/);
  });

  it('is placed inside the table container (the footer of TableShell), never outside it', () => {
    assert.match(read('src/app/accounts/page.js'), /<TableShell footer=\{<Pager /);
    assert.match(read('src/app/logs/page.js'), /<TableShell\s+footer=\{\s*<Pager/);
    assert.match(read('src/components/ui/DataTable.js'), /footer=\{pagination \? <Pager /);
  });

  it('there is one pager: the older text layout is gone, and the public services page uses the standard one', () => {
    const users = sources.filter((f) => /variant="simple"/.test(readFileSync(f, 'utf8'))).map(rel);
    assert.deepEqual(users, []);
    assert.doesNotMatch(read('src/components/navigation/Pager.js'), /variant === 'simple'/);
    assert.match(read('src/components/public/PublicDirectory.js'), /<Pager page=\{current\} pageSize=\{pageSize\}/);
  });
});

describe('row controls', () => {
  it('the row menu and the expand arrow share the same icon button, with an accessible label', () => {
    assert.match(read('src/components/ui/RowActionMenu.js'), /'row-icon-button'/);
    assert.match(read('src/components/ui/RowActionMenu.js'), /aria-label=\{label\}/);
    assert.match(read('src/app/logs/page.js'), /className="row-icon-button"/);
  });

  it('each audit row has exactly one details button (the arrow), not two with the same label', () => {
    const page = read('src/app/logs/page.js');
    assert.equal([...page.matchAll(/aria-label=\{`\$\{open \? 'Hide' : 'Show'\} details of /g)].length, 1);
  });
});

describe('Phase 3 table, sorting, tabs and summary consistency', () => {
  it('defines a shared summary/total row token and uses it across Registry, Reports and Ratings totals rows', () => {
    assert.match(css, /@utility tr-summary \{\s*@apply h-\[52px\] border-t-2 border-line bg-surface-muted font-semibold text-ink;/);
    for (const file of [
      'src/app/registry/RegistryOverview.js',
      'src/components/reports/ReportDetail.js',
      'src/components/reports/PeopleReportSheet.js',
      'src/components/ratings/RatingsSection.js',
    ]) {
      assert.match(read(file), /tr-summary/, file);
    }
  });

  it('DataTable uses neutral ink tokens in its summary bar and standardized gold/muted dual SortIcon indicators', () => {
    const dt = read('src/components/ui/DataTable.js');
    assert.doesNotMatch(dt, /stone-/);
    assert.match(dt, /text-ink-muted/);
    assert.match(dt, /text-ink/);
    assert.match(dt, /text-pup-gold/);
  });

  it('Pager item-size dropdown carries the custom chevron styling consistent with other selects', () => {
    assert.match(css, /@utility page-size-select \{[^}]*appearance-none[^}]*background-image:/);
  });

  it('Tabs default and analytics variants share maroon active indicator, muted inactive ink, and horizontal scroll', () => {
    const tabs = read('src/components/ui/Tabs.js');
    assert.equal([...tabs.matchAll(/overflow-x-auto/g)].length >= 2, true);
    assert.equal([...tabs.matchAll(/border-\[#800000\]/g)].length >= 2, true);
    assert.doesNotMatch(tabs, /border-gold-500/);
  });
});

describe('System-wide table typography standardization', () => {
  it('globals.css defines centralized table tokens, DM Sans header/body utilities, and semantic cell utilities', () => {
    for (const token of ['--table-font-family', '--table-head-size', '--table-body-size', '--table-row-height']) {
      assert.ok(css.includes(`${token}:`), `missing ${token}`);
    }
    for (const util of ['@utility td-primary', '@utility td-id', '@utility td-medium', '@utility td-secondary', '@utility td-muted', '@utility td-num']) {
      assert.ok(css.includes(util), `missing ${util}`);
    }
    const rowAction = /@utility row-action \{\s*@apply ([^;]+);/.exec(css)[1];
    assert.ok(rowAction.split(/\s+/).includes('text-xs'), 'row-action uses the 12px table scale');
    assert.ok(!rowAction.split(/\s+/).includes('text-sm'), 'row-action never enlarges table cells to text-sm');
  });

  it('no <Th> across the codebase overrides the burgundy table header with bg-white', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/<Th\b[^>]*>/g)) {
        assert.doesNotMatch(match[0], /\bbg-white\b/, `${rel(file)}: ${match[0]}`);
      }
    }
  });

  it('table cells use DM Sans + tabular-nums rather than font-mono', () => {
    for (const file of [
      'src/app/offices/page.js',
      'src/app/transactions/page.js',
      'src/app/logs/page.js',
      'src/app/registry/RegistryOverview.js',
      'src/components/home/KpiHome.js',
      'src/components/dashboard/office-head/StaffPerformanceTab.js',
      'src/components/dashboard/office-head/OperationsTab.js',
      'src/components/dashboard/office-head/ComplaintsTab.js',
      'src/components/dashboard/CaseFlagsPanel.js',
    ]) {
      assert.doesNotMatch(read(file), /\bfont-mono\b/, file);
    }
    const lateRisk = read('src/components/analytics/LateRiskSection.js');
    const lateRiskTable = lateRisk.slice(lateRisk.indexOf('export function LateRiskTable'), lateRisk.indexOf('export default function LateRiskSection'));
    assert.doesNotMatch(lateRiskTable, /\bfont-mono\b/, 'LateRiskTable');

    const compliance = read('src/components/dashboard/office-head/ComplianceServiceTab.js');
    const complianceTable = compliance.slice(compliance.indexOf('<DataTable'), compliance.indexOf('<ServiceCharterPanel'));
    assert.doesNotMatch(complianceTable, /\bfont-mono\b/, 'ComplianceServiceTab DataTable');

    const unusual = read('src/components/dashboard/UnusualCasesPanel.js');
    const unusualTable = unusual.slice(unusual.indexOf('const unusualCols'), unusual.indexOf('const description'));
    assert.doesNotMatch(unusualTable, /\bfont-mono\b/, 'UnusualCasesPanel columns');
  });

  it('dense tables do not enlarge body cells above text-xs with text-sm overrides', () => {
    const matrix = read('src/components/account/RolesMatrix.js');
    const matrixTable = matrix.slice(matrix.indexOf('<Table'));
    assert.doesNotMatch(matrixTable, /\btext-sm\b/, 'RolesMatrix table');

    const overview = read('src/app/registry/RegistryOverview.js');
    const overviewTables = [...overview.matchAll(/<Table\b[\s\S]*?<\/Table>/g)].map((m) => m[0]);
    assert.equal(overviewTables.length, 2);
    for (const tbl of overviewTables) assert.doesNotMatch(tbl, /\btext-sm\b/, 'RegistryOverview tables');

    const charter = read('src/components/dashboard/ServiceCharterPanel.js');
    const charterCols = charter.slice(charter.indexOf('const charterCols'), charter.indexOf('const charterEmptyMessage'));
    assert.doesNotMatch(charterCols, /\btext-sm\b/, 'ServiceCharterPanel table columns');

    const ops = read('src/components/dashboard/office-head/OperationsTab.js');
    const opsCols = ops.slice(ops.indexOf('const pendingColumns'), ops.indexOf('const additionalTiles'));
    assert.doesNotMatch(opsCols, /\btext-sm\b/, 'OperationsTab pendingColumns');
  });

  it('keeps timestamps regular + tabular and emphasizes primary row identifiers consistently', () => {
    const tx = read('src/app/transactions/page.js');
    assert.match(tx, /<span className="block tabular-nums text-ink">\{date\}<\/span>/);
    assert.match(tx, /<span className="td-secondary tabular-nums">\{time\}<\/span>/);
    assert.doesNotMatch(tx, /<span className="block font-semibold text-slate-900">\{officeName\(t\)\}/);

    const logs = read('src/app/logs/page.js');
    assert.match(logs, /<span className="block tabular-nums text-ink">\{date\}<\/span>/);
    assert.match(logs, /<span className="block td-primary"[^>]*>\{actorNameText\}<\/span>/);
    assert.doesNotMatch(logs, /font-bold text-slate-900">\{office\.name\}/);
    assert.doesNotMatch(logs, /font-bold text-slate-900">Campus-wide/);

    for (const file of [
      'src/app/accounts/page.js',
      'src/app/offices/page.js',
      'src/app/calendar/Terms.js',
      'src/app/settings/Counters.js',
      'src/components/reports/ReportsPage.js',
      'src/components/reports/ReportDetail.js',
      'src/components/reports/PeopleReportSheet.js',
      'src/components/ratings/RatingsSection.js',
      'src/components/home/KpiHome.js',
    ]) {
      assert.match(read(file), /\btd-primary\b/, file);
    }
  });
});
