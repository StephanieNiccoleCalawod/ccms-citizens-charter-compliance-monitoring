// DEMO MODE ONLY (NEXT_PUBLIC_REGISTRY_DEMO=true in a development build). A stand-in for the registry service that lives in
// the browser tab so the Registry screen can be shown with sample data. It holds nothing after a page reload.
import { ApiError } from '../auth/session.js';
import { MAX_RECORDS } from '../ui/registry-import.js';

export const DEMO_COLUMNS = ['student_number', 'full_name', 'program', 'year_level', 'status', 'valid_until', 'email'];
const PROGRAMS = ['BSIT', 'BSCS', 'BSA', 'BSBA', 'BSED', 'BSECE', 'BSN', 'BSPSY'];

/** A CSV text from rows (arrays of cells), quoting cells that need it. */
export function toCsv(rows) {
  const cell = (v) => (/[",\n\r]/.test(String(v ?? '')) ? `"${String(v).replaceAll('"', '""')}"` : String(v ?? ''));
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

/** The demo registry: `count` valid records (default 2,350), mixed ENROLLED and ALUMNI over several programs. */
export function buildDemoValidCsv(count = 2350, { nameSuffix = '' } = {}) {
  const rows = [DEMO_COLUMNS];
  for (let i = 1; i <= count; i++) {
    const enrolled = i % 5 !== 0;
    rows.push([
      `2024-${String(i).padStart(5, '0')}-QC-0`, `Demo Student ${i}${nameSuffix}`, PROGRAMS[i % PROGRAMS.length],
      enrolled ? (i % 4) + 1 : '', enrolled ? 'ENROLLED' : 'ALUMNI', enrolled ? '06/30/2027' : '', '',
    ]);
  }
  return toCsv(rows);
}

/** The 12-row QA file: one good row and 11 rows that each break a rule, so a check reports 11 problems. */
export function buildDemoInvalidCsv() {
  const rows = [
    ['2024-90001-QC-0', 'Good Row', 'BSIT', 'ENROLLED', '2027-06-30'],
    ['2024-90002-QC-0', 'No Valid Until', 'BSIT', 'ENROLLED', ''],
    ['2024-90003-QC-0', 'Bad Status', 'BSIT', 'GRADUATING', '2027-06-30'],
    ['2024-90001-QC-0', 'Duplicate Number', 'BSCS', 'ENROLLED', '2027-06-30'],
    ['', 'No Student Number', 'BSIT', 'ALUMNI', ''],
    ['2024-90006-QC-0', '', 'BSIT', 'ENROLLED', '2027-06-30'],
    ['2024-90007-QC-0', 'No Program', '', 'ENROLLED', '2027-06-30'],
    ['2024-90008-QC-0', 'Bad Date', 'BSA', 'ENROLLED', '30/06/2027'],
    ['2024-90009-QC-0', 'Another Bad Status', 'BSA', 'DROPPED', ''],
    ['2024-90010-QC-0', 'Missing Date Again', 'BSBA', 'ENROLLED', ''],
    ['2024-90002-QC-0', 'Duplicate Of Row Three', 'BSBA', 'ALUMNI', ''],
    ['2024-90012-QC-0', 'Bad Date Again', 'BSED', 'ENROLLED', 'soon'],
  ];
  return toCsv([DEMO_COLUMNS, ...rows.map(([number, name, program, status, date]) => [
    number, name, program, status === 'ALUMNI' ? '' : '1', status, date === '2027-06-30' ? '06/30/2027' : date, '',
  ])]);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const fail = (message, status = 422, details) => new ApiError(message, { code: 'VALIDATION_FAILED', status, details });

/** Checks the rows against the demo's rules. Row numbers are file line numbers (the header is row 1). */
function check(records, byNumber) {
  const errors = [];
  const seen = new Set();
  let added = 0;
  let updated = 0;
  records.forEach((r, index) => {
    const row = index + 2;
    const problems = [];
    if (!r.student_number) problems.push('student_number is required');
    else if (seen.has(r.student_number)) problems.push('Student number is repeated in this file');
    seen.add(r.student_number);
    if (!r.full_name) problems.push('full_name is required');
    if (!r.program) problems.push('program is required');
    if (!['ENROLLED', 'ALUMNI'].includes(r.status)) problems.push('status must be ENROLLED or ALUMNI');
    if (r.status === 'ENROLLED' && !r.valid_until) problems.push('valid_until is required for ENROLLED records');
    else if (r.valid_until && !/^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/\d{4}$/.test(r.valid_until)) problems.push('valid_until must use MM/DD/YYYY');
    if (problems.length > 0) errors.push({ row, message: problems.join('; ') });
    else if (!byNumber.has(r.student_number)) added++;
    else if (DEMO_COLUMNS.some((name) => byNumber.get(r.student_number)[name] !== r[name])) updated++;
  });
  return { total: records.length, added, updated, invalid: errors.length, errors };
}

/** A fetcher with the same call shape as apiFetch(path, { method, body }) for the three registry routes. */
export function createDemoFetcher() {
  const registry = new Map();
  const history = [];
  let counter = 0;

  async function post(form) {
    const file = form.get('file');
    const dryRun = form.get('dryRun') === 'true';
    if (!/\.csv$/i.test(file?.name ?? '')) throw fail('Demo mode reads CSV files only. Use the CSV demo file.', 400);
    const rows = parseCsv(await file.text());
    const header = (rows.shift() ?? []).map((h) => h.trim());
    if (header.length !== DEMO_COLUMNS.length || DEMO_COLUMNS.some((name, index) => header[index] !== name)) {
      throw fail('Use the exact template columns in order.', 422);
    }
    if (rows.length > MAX_RECORDS) throw fail(`The file has more than ${MAX_RECORDS} records.`, 422);
    const records = rows.map((cells) => Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()])));
    const result = check(records, registry);
    if (dryRun) return result;
    if (result.invalid > 0) throw fail('The file has problems. Nothing was imported.', 422, { errors: result.errors });
    for (const r of records) registry.set(r.student_number, r);
    history.push({ import_id: `demo-${++counter}`, created_at: new Date().toISOString(), imported_by: 'Demo Super Admin', total: records.length, added: result.added, updated: result.updated, status: 'COMPLETED' });
    return result;
  }

  function summary() {
    const programs = new Map();
    let enrolled = 0;
    let alumni = 0;
    for (const { program: p, status } of registry.values()) {
      const entry = programs.get(p) ?? { program_code: p, enrolled: 0, alumni: 0 };
      if (status === 'ENROLLED') { entry.enrolled++; enrolled++; } else { entry.alumni++; alumni++; }
      programs.set(p, entry);
    }
    return { total: registry.size, enrolled, alumni, by_program: [...programs.values()].sort((a, b) => a.program_code.localeCompare(b.program_code)) };
  }

  return async function demoFetch(path, { method = 'GET', body } = {}) {
    if (method === 'POST' && path.endsWith('/registry/imports')) return post(body);
    if (path.endsWith('/registry/imports')) return { items: [...history].reverse(), total: history.length };
    if (path.endsWith('/registry/summary')) return summary();
    throw new ApiError('Not found', { status: 404 });
  };
}
