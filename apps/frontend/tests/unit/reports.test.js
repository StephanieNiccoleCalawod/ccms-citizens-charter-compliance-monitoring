// CC029 / CC030 / CC031 reports page: rules and source checks (not a browser).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES } from 'ccms-shared/roles';
import { REPORTS_API, downloadReportCsv, generateReport, listReports, publishReport, startNewVersion } from '../../src/lib/api/reports.js';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import { buildGenerateBody, canManageReports, failureMessage, figureRows, generateErrors, periodText, reasonError, reportActions, versionBanner } from '../../src/lib/ui/reports.js';
import { staffAccessFrom } from '../../src/lib/ui/account.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

const REPORT = {
  report_id: 'r1', status: 'PUBLISHED', version: 2, from: '2026-07-01', to: '2026-12-31',
  figures: { services: [{ service_id: 's1', service_name: 'Good Moral', received: 10, results: { on_time: 7, late_total: 2, late_auto_closed: 1, on_time_rate: 77.8 }, cancelled: 1, auto_closed: 1, pending: { count: 0 }, not_in_registry: 0 }], total: { received: 10, results: { on_time: 7, late_total: 2, late_auto_closed: 1, on_time_rate: 77.8 }, cancelled: 1, auto_closed: 1, pending: { count: 0 }, not_in_registry: 0 } },
};

describe('reports calls', () => {
  it('use the right addresses, methods and bodies', async () => {
    const calls = [];
    const f = async (path, options) => { calls.push([path, options]); return {}; };
    await generateReport({ officeId: 'o' }, f);
    await listReports({ officeId: 'o', periodType: 'monthly', status: 'DRAFT', page: 2, pageSize: 20 }, f);
    await publishReport('a b', f);
    await startNewVersion('r1', 'Fix', f);
    assert.deepEqual(calls[0], [REPORTS_API, { method: 'POST', body: { officeId: 'o' } }]);
    assert.equal(calls[1][0], `${REPORTS_API}?office_id=o&period_type=monthly&status=DRAFT&page=2&page_size=20`);
    assert.deepEqual(calls[2], [`${REPORTS_API}/a%20b/publish`, { method: 'POST', body: { confirm: true } }]);
    assert.deepEqual(calls[3], [`${REPORTS_API}/r1/new-version`, { method: 'POST', body: { reason: 'Fix' } }]);
  });
  it('the CSV is fetched with the bearer token and keeps the server file name', async () => {
    let seen;
    const fetchImpl = async (url, init) => { seen = [url, init.headers.authorization]; return { ok: true, headers: new Headers({ 'content-disposition': 'attachment; filename="report-x.csv"' }), blob: async () => new Blob(['a']) }; };
    const out = await downloadReportCsv('r1', { fetchImpl, token: 'tok' });
    assert.deepEqual(seen, ['/api/logs/reports/r1/export.csv', 'Bearer tok']);
    assert.equal(out.filename, 'report-x.csv');
    await assert.rejects(downloadReportCsv('r1', { fetchImpl: async () => ({ ok: false }), token: 't' }));
  });
});

describe('reports rules', () => {
  it('defaults to half-year and sends the selected date for a monthly draft', () => {
    assert.deepEqual(buildGenerateBody({ officeId: 'o' }), { officeId: 'o', periodType: 'half_year' });
    assert.deepEqual(buildGenerateBody({ officeId: 'o', periodType: 'monthly', date: '' }), { officeId: 'o', periodType: 'monthly' });
    assert.deepEqual(buildGenerateBody({ officeId: 'o', periodType: 'monthly', date: '2026-10-01' }), { officeId: 'o', periodType: 'monthly', date: '2026-10-01' });
    assert.deepEqual(buildGenerateBody({ officeId: 'o', periodType: 'custom', from: '2026-01-01', to: '2026-02-01', date: 'x' }), { officeId: 'o', periodType: 'custom', from: '2026-01-01', to: '2026-02-01' });
  });
  it('asks for an office, and for ordered dates on a custom period', () => {
    assert.ok(generateErrors({ officeId: '', periodType: 'half_year' }).officeId);
    assert.ok(generateErrors({ officeId: 'o', periodType: 'custom', from: '2026-03-01', to: '2026-02-01' }).from);
    assert.deepEqual(generateErrors({ officeId: 'o', periodType: 'half_year' }), {});
  });
  it('a correction needs a reason of at most 500 characters', () => {
    assert.ok(reasonError(''));
    assert.ok(reasonError('x'.repeat(501)));
    assert.equal(reasonError('Counted a cancelled one'), '');
  });
  it('only Super Admin and Office Head manage; nobody else gets publish or correct', () => {
    for (const role of [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD]) assert.equal(canManageReports(role), true);
    for (const role of [ROLES.EXECUTIVE, ROLES.OFFICE_STAFF]) {
      assert.equal(canManageReports(role), false);
      const a = reportActions({ status: 'DRAFT' }, role);
      assert.equal(a.publish, false); assert.equal(a.correct, false); assert.equal(a.csv, true);
    }
    assert.equal(reportActions({ status: 'DRAFT' }, ROLES.OFFICE_HEAD).publish, true);
    assert.equal(reportActions({ status: 'PUBLISHED' }, ROLES.OFFICE_HEAD).correct, true);
    assert.equal(reportActions({ status: 'PUBLISHED' }, ROLES.OFFICE_HEAD).publish, false);
  });
  it('the superseded banner names the new version; a correction draft shows its reason', () => {
    assert.equal(versionBanner({ status: 'SUPERSEDED', replaced_by_version: 3, replaced_by_report_id: 'x' }).text, 'Replaced by version 3');
    assert.match(versionBanner({ status: 'DRAFT', supersedes_report_id: 'p', supersede_reason: 'Typo' }).text, /Typo/);
    assert.equal(versionBanner({ status: 'PUBLISHED' }), null);
  });
  it('the figures table has one row per service and a total; cancelled, auto-closed and pending are their own columns', () => {
    const rows = figureRows(REPORT);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].total, true);
    assert.equal(rows[0].rate, '77.8%');
    assert.equal(rows[0].cancelled, '1');
    assert.equal(figureRows({ figures: { services: [], total: { results: {} } } })[0].rate, 'No rate yet');
    assert.equal(periodText(REPORT), 'July 1 – December 31, 2026');
  });
  it('server codes become plain sentences', () => {
    assert.match(failureMessage({ code: 'REPORT_ALREADY_PUBLISHED' }), /new version/);
    assert.match(failureMessage({ code: 'CORE_UNAVAILABLE' }), /Nothing was saved/);
    assert.match(failureMessage({ status: 403 }), /permission/);
  });
});

describe('reports menu and screens', () => {
  it('Office Staff get the Reports item only while the switch is on', () => {
    const has = (access) => appNavForRole(ROLES.OFFICE_STAFF, access).some((i) => i.href === '/reports');
    assert.equal(has({}), false);
    assert.equal(has({ reports: false }), false);
    assert.equal(has({ reports: true }), true);
    for (const role of [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.EXECUTIVE]) assert.ok(appNavForRole(role).some((i) => i.href === '/reports'), role);
  });
  it('staffAccessFrom reads the switches from "What I can do" and treats anything unclear as no', () => {
    const me = { what_i_can_do: [{ switch_key: 'STAFF_VIEW_REPORTS', switch_on: true }, { switch_key: 'STAFF_VIEW_COMPLAINTS', switch_on: false }] };
    assert.deepEqual(staffAccessFrom(me), { reports: true, complaints: false });
    assert.deepEqual(staffAccessFrom(undefined), { reports: false, complaints: false });
  });
  it('the figures use the shared table; the page has no edit or delete; print hides the page chrome', () => {
    const page = read('src/components/reports/ReportsPage.js');
    const detail = read('src/components/reports/ReportDetail.js');
    assert.ok(!/<table|<thead|<th[ >]/.test(page) && !/<table|<thead|<th[ >]/.test(detail), 'tables only through the shared components');
    assert.ok(!/delete|Delete/.test(page) && !/delete|Delete/.test(detail));
    assert.match(detail, /print:hidden/);
    assert.match(read('src/app/globals.css'), /\.report-print-area/);
  });
  it('the Executive and Office Staff views never show who published', () => {
    const page = read('src/components/reports/ReportDetail.js');
    assert.match(page, /manage \? publishedByText\(report\) : formatDateTime\(report\.published_at\)/);
  });
});

describe('the on-screen report and the official printed document are separate layouts', () => {
  const detail = read('src/components/reports/ReportDetail.js');
  const css = read('src/app/globals.css');

  it('the on-screen page has a clean header (title, office, status badge, period, version, generated) and is hidden from print', () => {
    assert.match(detail, /print:hidden" data-testid="report-page-header"/);
    assert.match(detail, /title-page/);
    assert.match(detail, /<StatusBadge variant=\{report\.status\}/);
    assert.match(detail, /print:hidden" data-testid="report-onscreen-body"/);
  });

  it('the figures table is one component reused by both layouts, not a second calculation', () => {
    const occurrences = [...detail.matchAll(/<FiguresTable report=\{report\} \/>/g)];
    assert.equal(occurrences.length, 2, 'FiguresTable is rendered once on screen and once in the print document');
  });

  it('report notes are a collapsible <details> on screen, and the same text plainly in the printed document', () => {
    assert.match(detail, /<details[^>]*data-testid="report-notes"/);
    assert.equal([...detail.matchAll(/<ReportNotesList report=\{report\} \/>/g)].length, 2);
  });

  it('the official document is hidden on screen and shown only for print, via the same .report-print-area the print stylesheet already targets', () => {
    assert.match(detail, /className="report-print-area hidden card space-y-4 p-6 print:block"/);
  });

  it('the printed document keeps the PUP header, full metadata, the figures table and the signature section', () => {
    const sheet = detail.slice(detail.indexOf('data-testid="report-sheet"'));
    assert.match(sheet, /pup-logo\.png/);
    assert.match(sheet, /Polytechnic University of the Philippines, Quezon City/);
    assert.match(sheet, /<FiguresTable report=\{report\} \/>/);
    assert.match(sheet, /<SignatureLines \/>/);
  });

  it('the official page is forced to A4 landscape, not left to the printer', () => {
    assert.match(css, /@page report\s*\{[^}]*size:\s*A4 landscape;/);
  });

  it('the figures table gets print-specific column widths and type size instead of being shrunk to fit', () => {
    assert.match(css, /\.report-print-area \[data-testid="report-figures"\] table\s*\{[^}]*table-layout:\s*fixed;/);
    assert.match(css, /\.report-print-area \[data-testid="report-figures"\] th:first-child,\s*\n\s*\.report-print-area \[data-testid="report-figures"\] td:first-child\s*\{\s*\n\s*width:\s*20%;/);
  });
});
