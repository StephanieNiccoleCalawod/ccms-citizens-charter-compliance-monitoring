// CC043: Student and Alumni Registry import, the parts that are not React. Pure functions so they can be tested without a browser.
//
// The Operations service owns every real rule (required columns, duplicate student numbers, valid_until for ENROLLED,
// all-or-nothing). This file only (1) refuses files that can never be accepted, before any upload, and (2) turns the answers
// into the shapes the screen shows. It never decides that an import "worked": only an answer without errors counts.

import { ROLES } from 'ccms-shared/roles';

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB
export const MAX_RECORDS = 10_000;
export const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx'];
export const ACCEPT_ATTRIBUTE = '.csv,.xlsx';
export const MAX_ERRORS_SHOWN = 500;

export const REGISTRY_STATUS = Object.freeze({ ENROLLED: 'ENROLLED', ALUMNI: 'ALUMNI' });

const extensionOf = (name) => {
  const dot = String(name ?? '').lastIndexOf('.');
  return dot === -1 ? '' : String(name).slice(dot).toLowerCase();
};

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Number of data rows in CSV text (the header row and blank lines are not counted; quoted line breaks stay inside one row). */
export function countCsvRecords(text) {
  let rows = 0;
  let inQuotes = false;
  let rowHasContent = false;
  const source = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      if (inQuotes && source[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
      rowHasContent = true;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      if (rowHasContent) rows++;
      rowHasContent = false;
    } else if (!/\s/.test(ch) || inQuotes) {
      rowHasContent = true;
    }
  }
  if (rowHasContent) rows++;
  return Math.max(0, rows - 1);
}

/**
 * Checks a chosen file before upload. `file` needs { name, size }; `csvText` is the text of a CSV (omit for XLSX, whose rows
 * only the server can count). Returns { ok: true } or { ok: false, message }.
 */
export function validateRegistryFile(file, csvText) {
  if (!file) return { ok: false, message: 'Choose a CSV or XLSX file first.' };
  const extension = extensionOf(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    return { ok: false, message: 'Unsupported file type. Choose a .csv or .xlsx file.' };
  }
  if (!(file.size > 0)) return { ok: false, message: 'This file is empty.' };
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: `This file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.` };
  }
  if (extension === '.csv' && typeof csvText === 'string') {
    const records = countCsvRecords(csvText);
    if (records === 0) return { ok: false, message: 'The file has no records. It needs a header row and at least one data row.' };
    if (records > MAX_RECORDS) {
      return { ok: false, message: `The file has ${records.toLocaleString('en-PH')} records. The limit is ${MAX_RECORDS.toLocaleString('en-PH')}.` };
    }
  }
  return { ok: true };
}

const count = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : 0);

/** One validation problem, whatever spelling the service used for its parts. */
function toIssue(entry) {
  if (typeof entry === 'string') return { row: null, message: entry };
  const row = entry?.row ?? entry?.row_number ?? entry?.line ?? null;
  const message = entry?.message ?? entry?.reason ?? entry?.error ?? entry?.detail ?? 'Invalid row.';
  return { row: row === null || row === undefined || row === '' ? null : Number(row) || row, message: String(message) };
}

/** The list of problems in an answer or an error's details, as [{ row, message }] (empty when there are none). */
export function extractIssues(source) {
  const list = source?.errors ?? source?.invalid_rows ?? source?.issues ?? source?.details?.errors ?? [];
  return Array.isArray(list) ? list.map(toIssue) : [];
}

/** A dry-run (Check file) answer: counts, problems and whether the file may be imported. */
export function normalizeCheck(answer) {
  const errors = extractIssues(answer);
  const invalid = Math.max(count(answer?.invalid ?? answer?.invalid_count), errors.length);
  const failed = /^(fail|error|invalid)/i.test(String(answer?.status ?? ''));
  return {
    added: count(answer?.added ?? answer?.added_count),
    updated: count(answer?.updated ?? answer?.updated_count),
    invalid,
    errors,
    valid: invalid === 0 && !failed,
  };
}

/** The answer to a real import. `ok` is true only when the service reports no problems at all. */
export function normalizeImportResult(answer) {
  const check = normalizeCheck(answer);
  return { ...check, ok: check.valid, processed: count(answer?.total ?? answer?.processed ?? answer?.total_processed) || check.added + check.updated };
}

/** What a failed call looks like to the person: a message plus any row problems the service listed (it imports nothing then). */
export function describeFailure(error) {
  const issues = extractIssues(error);
  const missing = error?.status === 404 || error?.status === 501;
  let message = error?.message || 'Something went wrong. Please try again.';
  if (missing) message = 'The registry import service is not available yet. Contact the administrator.';
  else if (error?.status === 403) message = 'Only a Super Admin may import the registry.';
  else if (error?.status === 413) message = 'The server refused this file because it is too large.';
  else if (error?.code === 'NETWORK_ERROR') message = 'Cannot reach the server. Check your connection and try again.';
  else if (issues.length > 0 && !error?.message) message = 'The file has problems.';
  return { message, issues, unavailable: missing };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The summary screen data from GET /summary, whether statuses come as an object or a list. */
export function normalizeSummary(answer) {
  const byStatus = {};
  const rawStatus = answer?.by_status ?? answer?.statuses ?? [];
  if (Array.isArray(rawStatus)) for (const s of rawStatus) byStatus[String(s.status).toUpperCase()] = num(s.count ?? s.total);
  else for (const [key, value] of Object.entries(rawStatus)) byStatus[key.toUpperCase()] = num(value);
  const enrolled = num(answer?.enrolled ?? answer?.enrolled_count ?? byStatus.ENROLLED);
  const alumni = num(answer?.alumni ?? answer?.alumni_count ?? byStatus.ALUMNI);
  const programs = (answer?.by_program ?? answer?.programs ?? []).map((p) => {
    const e = num(p.enrolled ?? p.ENROLLED);
    const a = num(p.alumni ?? p.ALUMNI);
    return { program_code: String(p.program_code ?? p.program ?? '—'), enrolled: e, alumni: a, total: num(p.total ?? p.count) || e + a };
  });
  return { total: num(answer?.total ?? answer?.total_records) || enrolled + alumni, enrolled, alumni, programs };
}

/** The import history rows from GET /imports (newest first). */
export function normalizeHistory(answer) {
  const list = Array.isArray(answer) ? answer : (answer?.items ?? []);
  return list
    .map((row, index) => {
      const added = num(row.added ?? row.added_count);
      const updated = num(row.updated ?? row.updated_count);
      return {
        id: String(row.import_id ?? row.id ?? `row-${index}`),
        at: row.created_at ?? row.imported_at ?? row.started_at ?? null,
        by: row.imported_by_name ?? row.imported_by ?? row.actor ?? null,
        processed: num(row.total ?? row.processed ?? row.total_processed) || added + updated,
        added,
        updated,
        failed: /^(fail|error)/i.test(String(row.status ?? '')),
        status: row.status ? String(row.status) : null,
      };
    })
    .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
}

/** The Import button is on only for the exact file that passed Check file, and never while something is running. */
export function canImport({ file, checkedFile, check, busy }) {
  return Boolean(file) && file === checkedFile && Boolean(check?.valid) && !busy;
}

/** Only the Super Admin may use the registry (the services check again). */
export function canUseRegistry(role) {
  return role === ROLES.SUPER_ADMIN;
}
