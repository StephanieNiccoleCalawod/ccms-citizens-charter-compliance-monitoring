// CC043 frontend checks use a fake fetcher and the in-browser demo. The Operations routes have separate database tests.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLES, ROLE_LIST } from 'ccms-shared/roles';
import { ApiError } from '../../src/lib/auth/session.js';
import { appNavForRole, registryNav } from '../../src/lib/auth/permissions.js';
import { isRoleAllowed } from '../../src/lib/auth/guards.js';
import { REGISTRY_IMPORTS_API, REGISTRY_SUMMARY_API, checkRegistryFile, getRegistrySummary, importRegistry, isRegistryDemo, listRegistryImports } from '../../src/lib/api/registry.js';
import { buildDemoInvalidCsv, buildDemoValidCsv, createDemoFetcher } from '../../src/lib/api/registry-demo.js';
import {
  MAX_FILE_BYTES,
  MAX_RECORDS,
  canImport,
  canUseRegistry,
  countCsvRecords,
  describeFailure,
  extractIssues,
  formatBytes,
  normalizeCheck,
  normalizeHistory,
  normalizeImportResult,
  normalizeSummary,
  validateRegistryFile,
} from '../../src/lib/ui/registry-import.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const csvFile = (text, name = 'registry.csv') => new File([text], name, { type: 'text/csv' });

describe('file validation before upload', () => {
  it('accepts a CSV or XLSX within the limits, in any letter case', () => {
    assert.deepEqual(validateRegistryFile({ name: 'a.csv', size: 100 }, 'h\nr1\nr2'), { ok: true });
    assert.deepEqual(validateRegistryFile({ name: 'A.XLSX', size: 100 }), { ok: true });
  });

  it('refuses a missing, unsupported, empty or too-large file with a clear message', () => {
    assert.match(validateRegistryFile(null).message, /Choose/);
    assert.match(validateRegistryFile({ name: 'a.pdf', size: 10 }).message, /Unsupported file type/);
    assert.match(validateRegistryFile({ name: 'a', size: 10 }).message, /Unsupported file type/);
    assert.match(validateRegistryFile({ name: 'a.csv', size: 0 }).message, /empty/);
    const limit = 4 * 1024 * 1024;
    const big = validateRegistryFile({ name: 'a.csv', size: limit + 1 });
    assert.equal(big.ok, false);
    assert.match(big.message, /limit is 4\.00 MB/);
    assert.equal(validateRegistryFile({ name: 'a.csv', size: limit }, 'h\nr').ok, true, 'exactly 4 MB is allowed');
    assert.equal(validateRegistryFile({ name: 'a.xlsx', size: limit }).ok, true);
    assert.equal(validateRegistryFile({ name: 'a.xlsx', size: limit + 1 }).ok, false);
  });

  it('counts CSV records without the header, blank lines or quoted line breaks, and refuses more than 10,000', () => {
    assert.equal(countCsvRecords('a,b\n1,2\n\n3,4\n'), 2);
    assert.equal(countCsvRecords('a,b\r\n1,"x\ny"\r\n'), 1);
    assert.equal(countCsvRecords('﻿a,b\n1,2'), 1);
    assert.equal(countCsvRecords(''), 0);
    const rows = (n) => `h\n${Array.from({ length: n }, (_, i) => i).join('\n')}`;
    assert.equal(validateRegistryFile({ name: 'a.csv', size: 5 }, rows(MAX_RECORDS)).ok, true);
    assert.match(validateRegistryFile({ name: 'a.csv', size: 5 }, rows(MAX_RECORDS + 1)).message, /10,000/);
    assert.match(validateRegistryFile({ name: 'a.csv', size: 5 }, 'only,a,header').message, /no records/);
  });

  it('formats sizes', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2.0 KB');
    assert.equal(formatBytes(MAX_FILE_BYTES), '4.00 MB');
  });
});

describe('the API boundary', () => {
  const calls = [];
  const fake = (answer = {}) => async (path, options = {}) => {
    calls.push({ path, ...options });
    return answer;
  };

  it('Check file posts the file with dryRun=true to the Operations registry imports route', async () => {
    calls.length = 0;
    await checkRegistryFile(csvFile('h\n1'), fake());
    assert.equal(calls[0].path, '/api/operations/registry/imports');
    assert.equal(calls[0].method, 'POST');
    assert.ok(calls[0].body instanceof FormData);
    assert.equal(calls[0].body.get('dryRun'), 'true');
    assert.equal(calls[0].body.get('file').name, 'registry.csv');
  });

  it('Import posts dryRun=false; history and summary are plain GETs', async () => {
    calls.length = 0;
    await importRegistry(csvFile('h\n1'), { dryRun: false }, fake());
    assert.equal(calls[0].body.get('dryRun'), 'false');
    calls.length = 0;
    await listRegistryImports(fake());
    await getRegistrySummary(fake());
    assert.deepEqual(calls.map((c) => [c.path, c.method]), [[REGISTRY_IMPORTS_API, undefined], [REGISTRY_SUMMARY_API, undefined]]);
  });

  it('apiFetch sends a FormData body untouched (no JSON content type, no stringify)', () => {
    const session = read('src/lib/auth/session.js');
    assert.match(session, /body instanceof FormData/);
    assert.match(session, /body === undefined \|\| isForm \? \{\}/);
  });
});

describe('dry run (Check file) and its answers', () => {
  it('reports counts and keeps the file importable only when nothing is invalid', () => {
    const ok = normalizeCheck({ added: 2000, updated: 350, invalid: 0 });
    assert.deepEqual([ok.added, ok.updated, ok.invalid, ok.valid], [2000, 350, 0, true]);
    const bad = normalizeCheck({ added: 0, updated: 0, invalid: 11, errors: [{ row: 3, message: 'x' }] });
    assert.equal(bad.valid, false);
    assert.equal(bad.invalid, 11);
  });

  it('counts listed errors even when the service sent no invalid number, and treats a failed status as invalid', () => {
    assert.equal(normalizeCheck({ errors: [{ row: 2, reason: 'a' }, { row: 3, reason: 'b' }] }).invalid, 2);
    assert.equal(normalizeCheck({ status: 'FAILED' }).valid, false);
  });

  it('does not write anything on a dry run (demo stand-in): the summary and history stay empty', async () => {
    const demo = createDemoFetcher();
    await checkRegistryFile(csvFile(buildDemoValidCsv(50)), demo);
    assert.equal((await getRegistrySummary(demo)).total, 0);
    assert.equal((await listRegistryImports(demo)).items.length, 0);
  });

  it('Import is on only for the exact file that passed the check, and never while busy', () => {
    const file = {};
    const check = { valid: true };
    assert.equal(canImport({ file, checkedFile: file, check, busy: false }), true);
    assert.equal(canImport({ file, checkedFile: {}, check, busy: false }), false, 'a replaced file must be checked again');
    assert.equal(canImport({ file, checkedFile: file, check: { valid: false }, busy: false }), false);
    assert.equal(canImport({ file, checkedFile: file, check, busy: true }), false);
    assert.equal(canImport({ file: null, checkedFile: null, check: null, busy: false }), false);
  });
});

describe('acceptance checks against the demo stand-in', () => {
  it('AC1: the 2,350-record registry validates and imports', async () => {
    const demo = createDemoFetcher();
    const file = csvFile(buildDemoValidCsv(2350));
    const check = normalizeCheck(await checkRegistryFile(file, demo));
    assert.deepEqual([check.added, check.updated, check.invalid, check.valid], [2350, 0, 0, true]);
    const done = normalizeImportResult(await importRegistry(file, { dryRun: false }, demo));
    assert.equal(done.ok, true);
    assert.equal(done.processed, 2350);
    const summary = normalizeSummary(await getRegistrySummary(demo));
    assert.equal(summary.total, 2350);
    assert.equal(summary.enrolled + summary.alumni, 2350);
    assert.ok(summary.programs.length > 1);
    assert.equal(summary.programs.reduce((sum, p) => sum + p.total, 0), 2350);
  });

  it('AC2: the 12-row invalid file shows all 11 errors with their row numbers, and an import is refused with nothing written', async () => {
    const demo = createDemoFetcher();
    const file = csvFile(buildDemoInvalidCsv());
    const check = normalizeCheck(await checkRegistryFile(file, demo));
    assert.equal(check.valid, false);
    assert.equal(check.invalid, 11);
    assert.equal(check.errors.length, 11);
    assert.deepEqual(check.errors.map((e) => e.row), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    assert.ok(check.errors.every((e) => e.message.length > 0));
    await assert.rejects(importRegistry(file, { dryRun: false }, demo), (error) => {
      const failure = describeFailure(error);
      assert.equal(failure.issues.length, 11);
      return true;
    });
    assert.equal((await getRegistrySummary(demo)).total, 0, 'all or nothing: the good row was not imported either');
    assert.equal((await listRegistryImports(demo)).items.length, 0);
  });

  it('AC3: a re-import updates existing records instead of adding them again', async () => {
    const demo = createDemoFetcher();
    await importRegistry(csvFile(buildDemoValidCsv(100)), { dryRun: false }, demo);
    const again = normalizeCheck(await checkRegistryFile(csvFile(buildDemoValidCsv(120)), demo));
    assert.deepEqual([again.added, again.updated], [20, 0]);
    const amended = csvFile(buildDemoValidCsv(120, { nameSuffix: ' updated' }));
    const changed = await importRegistry(amended, { dryRun: false }, demo);
    assert.deepEqual([changed.added, changed.updated], [20, 100]);
    assert.equal(normalizeSummary(await getRegistrySummary(demo)).total, 120);
    assert.equal(normalizeHistory(await listRegistryImports(demo)).length, 2);
  });

  it('the validation problems named in the brief are all reported by row', async () => {
    const demo = createDemoFetcher();
    const messages = normalizeCheck(await checkRegistryFile(csvFile(buildDemoInvalidCsv()), demo)).errors.map((e) => e.message).join('\n');
    assert.match(messages, /valid_until is required for ENROLLED/);
    assert.match(messages, /Student number is repeated/);
    await assert.rejects(importRegistry(csvFile('student_number,full_name\n1,a'), { dryRun: false }, demo), /template columns in order/);
  });
});

describe('errors are rendered, never hidden', () => {
  it('reads problems from an answer or from an error\'s details, whatever the field names', () => {
    assert.deepEqual(extractIssues({ errors: [{ row_number: 4, reason: 'bad' }, 'plain text'] }), [{ row: 4, message: 'bad' }, { row: null, message: 'plain text' }]);
    assert.deepEqual(extractIssues({ details: { errors: [{ row: 2, message: 'm' }] } }), [{ row: 2, message: 'm' }]);
    assert.deepEqual(extractIssues(null), []);
  });

  it('explains network, forbidden, too-large and not-yet-available failures', () => {
    assert.match(describeFailure(new ApiError('x', { code: 'NETWORK_ERROR' })).message, /Cannot reach the server/);
    assert.match(describeFailure(new ApiError('x', { status: 403 })).message, /Super Admin/);
    assert.match(describeFailure(new ApiError('x', { status: 413 })).message, /too large/);
    const missing = describeFailure(new ApiError('Not found', { status: 404 }));
    assert.equal(missing.unavailable, true);
    assert.match(missing.message, /not available yet/);
    assert.match(describeFailure(null).message, /Something went wrong/);
  });

  it('keeps the service\'s own message for a validation failure and lists its rows', () => {
    const failure = describeFailure(new ApiError('The file has problems.', { status: 422, details: { errors: [{ row: 5, message: 'dup' }] } }));
    assert.equal(failure.message, 'The file has problems.');
    assert.deepEqual(failure.issues, [{ row: 5, message: 'dup' }]);
  });

  it('never reports success when the service says it failed (a failed answer is not ok)', () => {
    assert.equal(normalizeImportResult({ added: 5, status: 'FAILED' }).ok, false);
    assert.equal(normalizeImportResult({ added: 5, errors: [{ row: 2, message: 'x' }] }).ok, false);
    assert.equal(normalizeImportResult({ added: 5, updated: 1 }).ok, true);
    const page = read('src/app/registry/ImportPanel.js');
    assert.match(page, /if \(!outcome\.ok\)/);
    assert.match(page, /Nothing was imported/);
    assert.ok(page.indexOf('notify.success') > page.indexOf('if (!outcome.ok)'), 'the success notice comes only after the failure branch');
  });
});

describe('import history and summary', () => {
  it('shows date, who, totals, added, updated and failed status, newest first', () => {
    const rows = normalizeHistory({
      items: [
        { import_id: 'a', created_at: '2026-11-01T01:00:00Z', imported_by: 'Ana', added: 10, updated: 5 },
        { import_id: 'b', created_at: '2026-11-02T01:00:00Z', imported_by_name: 'Ben', total: 99, added: 0, updated: 0, status: 'FAILED' },
      ],
    });
    assert.deepEqual(rows.map((r) => r.id), ['b', 'a']);
    assert.equal(rows[0].failed, true);
    assert.equal(rows[0].processed, 99);
    assert.deepEqual([rows[1].processed, rows[1].added, rows[1].updated, rows[1].by], [15, 10, 5, 'Ana']);
    assert.deepEqual(normalizeHistory(null), []);
  });

  it('builds the summary from statuses given as an object or a list, and by program', () => {
    const fromObject = normalizeSummary({ by_status: { ENROLLED: 7, ALUMNI: 3 }, by_program: [{ program_code: 'BSIT', enrolled: 7, alumni: 3 }] });
    assert.deepEqual([fromObject.total, fromObject.enrolled, fromObject.alumni, fromObject.programs[0].total], [10, 7, 3, 10]);
    const fromList = normalizeSummary({ total: 10, by_status: [{ status: 'enrolled', count: 6 }, { status: 'ALUMNI', count: 4 }] });
    assert.deepEqual([fromList.enrolled, fromList.alumni], [6, 4]);
    assert.deepEqual(normalizeSummary(null), { total: 0, enrolled: 0, alumni: 0, programs: [] });
  });
});

describe('who may use the Registry', () => {
  it('only Super Admin has the menu item, passes the page check and counts as allowed', () => {
    for (const role of ROLE_LIST) {
      const isAdmin = role === ROLES.SUPER_ADMIN;
      assert.equal(canUseRegistry(role), isAdmin, role);
      assert.equal(registryNav(role) !== null, isAdmin, role);
      assert.equal(appNavForRole(role).some((item) => item.href === '/registry'), isAdmin, role);
      assert.equal(isRoleAllowed({ role }, [ROLES.SUPER_ADMIN]), isAdmin, role);
    }
  });

  it('the page itself is limited to Super Admin and loads nothing for others (the shell renders its children only when allowed)', () => {
    const page = read('src/app/registry/page.js');
    assert.match(page, /allowedRoles=\{\[ROLES\.SUPER_ADMIN\]\}/);
    assert.match(page, /<AppShell/);
    const shell = read('src/components/layout/AppShell.js');
    assert.match(shell, /\{allowed \? \(/);
  });
});

describe('demo data stays out of normal use', () => {
  it('demo mode is on only for an explicit flag outside production', () => {
    assert.equal(isRegistryDemo('true', 'development'), true);
    assert.equal(isRegistryDemo('true', 'production'), false);
    assert.equal(isRegistryDemo(undefined, 'development'), false);
    assert.equal(isRegistryDemo('false', 'development'), false);
  });

  it('the screens reach the demo stand-in only through the flag-checked fetcher; its download buttons show only in demo mode', () => {
    const api = read('src/lib/api/registry.js');
    assert.match(api, /if \(!isRegistryDemo\(\)\) return apiFetch/);
    const panel = read('src/app/registry/ImportPanel.js');
    assert.match(panel, /\{demo \? \(/);
    assert.doesNotMatch(read('src/app/registry/page.js') + read('src/app/registry/ImportHistory.js') + read('src/app/registry/RegistryOverview.js'), /registry-demo/);
  });
});

describe('the import screen\'s behaviour (source checks, not a browser)', () => {
  const panel = read('src/app/registry/ImportPanel.js');

  it('asks before importing, with the shared confirm dialog, and blocks a second submit while one runs', () => {
    assert.match(panel, /<ConfirmDialog/);
    assert.match(panel, /onClick=\{\(\) => setConfirmOpen\(true\)\}/);
    assert.match(panel, /useSingleSubmit\(\)/);
    assert.match(panel, /busy=\{importing\}/);
    assert.match(panel, /disabled=\{!ready\}/);
  });

  it('offers choose, replace and remove, shows the file name and size, and accepts only CSV and XLSX', () => {
    assert.match(panel, /accept=\{ACCEPT_ATTRIBUTE\}/);
    assert.match(panel, />Replace</);
    assert.match(panel, />Remove</);
    assert.match(panel, /formatBytes\(file\.size\)/);
  });

  it('has loading, empty, error and success states in each part', () => {
    const overview = read('src/app/registry/RegistryOverview.js');
    const history = read('src/app/registry/ImportHistory.js');
    for (const text of [overview, history]) {
      assert.match(text, /kind="loading"/);
      assert.match(text, /kind="error"/);
    }
    assert.match(overview, /No registry records yet/);
    assert.match(history, /No imports yet/);
    assert.match(panel, /The file passed the check/);
  });

  it('is responsive: grids collapse to one column on a phone and wide tables scroll inside their frame', () => {
    assert.match(read('src/app/registry/RegistryOverview.js'), /grid gap-4 sm:grid-cols-3/);
    assert.match(read('src/components/ui/TableShell.js'), /overflow-x-auto/);
    assert.match(panel, /flex flex-wrap/);
  });
});
