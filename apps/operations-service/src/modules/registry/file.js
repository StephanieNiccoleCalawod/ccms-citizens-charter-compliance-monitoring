import { AppError, Errors, isValidManilaDate } from 'ccms-shared';
import { parse } from 'csv-parse/sync';
import { readSheet } from 'read-excel-file/node';

// Leave room for multipart metadata under the hosted request limit.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 16 * 1024;
const MAX_ROWS = 10_000;
const HEADERS = ['student_number', 'full_name', 'program', 'year_level', 'status', 'valid_until', 'email'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROGRAM = /^[A-Z0-9-]{2,20}$/;
const fileError = (message, details = null) => Errors.badRequest(message, details, 'REGISTRY_INVALID_FILE');
const fileTooLarge = () => new AppError(413, 'REGISTRY_FILE_TOO_LARGE', 'The registry file must be 4 MB or smaller.');
const tooManyRows = () => fileError('The registry file must have at most 10,000 data rows.');

export async function readRegistryUpload(request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) {
    throw fileError('Send a registry file as multipart form data.');
  }
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) throw fileTooLarge();

  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => {});
        throw fileTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  let form;
  try {
    form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw fileError('The upload could not be read.');
  }
  const files = form.getAll('file');
  const options = form.getAll('dryRun');
  const file = files[0];
  if (files.length !== 1 || !(file instanceof File) || file.size === 0) throw fileError('Choose one non-empty CSV or XLSX file.');
  if (file.size > MAX_FILE_BYTES) throw fileTooLarge();
  if (options.length > 1 || (options.length && !['true', 'false'].includes(options[0]))) {
    throw fileError('dryRun must be true or false.');
  }
  const extension = file.name.match(/\.(csv|xlsx)$/i)?.[1].toLowerCase();
  if (!extension) throw fileError('Choose a .csv or .xlsx file.');
  return { file, extension, dryRun: options[0] === 'true' };
}

async function readRows(file, extension) {
  try {
    if (extension === 'xlsx') {
      // The reader resolves the workbook's first worksheet, including Excel date cells.
      const sheet = await readSheet(Buffer.from(await file.arrayBuffer()), 1);
      return sheet.map((record, index) => ({ record, row: index + 1 }));
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    let count = 0;
    return parse(source, {
      bom: true,
      info: true,
      relax_column_count: true,
      skip_empty_lines: true,
      on_record({ record, info }) {
        if (++count > MAX_ROWS + 1) throw tooManyRows();
        const embeddedLines = record.reduce((total, field) => total + (field.match(/\r\n|\r|\n/g)?.length ?? 0), 0);
        return { record, row: info.lines - embeddedLines };
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = extension === 'xlsx' ? 'The first worksheet could not be read.' : 'The file must be a readable UTF-8 CSV.';
    const errors = Number.isInteger(error?.lines) ? [{ row: error.lines, message }] : [];
    throw fileError(message, { errors });
  }
}

function validDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const iso = value.toISOString().slice(0, 10);
    return isValidManilaDate(iso) ? iso : null;
  }
  const parts = typeof value === 'string' ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim()) : null;
  if (!parts) return null;
  const [, month, day, year] = parts;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isValidManilaDate(iso) ? iso : null;
}

const textCell = (value) => typeof value === 'string' ? value.trim() : '';
const blank = (value) => value == null || (typeof value === 'string' && value.trim() === '');

function checkRow(record, seen, extension) {
  // Excel trims trailing empty cells. CSV rows must contain all seven columns.
  const wrongWidth = extension === 'csv'
    ? record.length !== HEADERS.length
    : record.slice(HEADERS.length).some((cell) => !blank(cell));
  if (wrongWidth) {
    return { message: 'Use exactly the seven template columns.' };
  }
  const [rawNumber, rawName, rawProgram, rawYear, rawStatus, rawDate, rawEmail] = record;
  const studentNumber = typeof rawNumber === 'number' && Number.isSafeInteger(rawNumber) ? String(rawNumber) : textCell(rawNumber);
  const fullName = textCell(rawName);
  const program = textCell(rawProgram);
  const status = textCell(rawStatus);
  const email = textCell(rawEmail) || null;
  const yearText = typeof rawYear === 'number' ? String(rawYear) : textCell(rawYear);
  const yearLevel = /^[1-6]$/.test(yearText) ? Number(yearText) : null;
  const validUntil = blank(rawDate) ? null : validDate(rawDate);
  const problems = [];

  if (!studentNumber || studentNumber.length > 30 || studentNumber.includes('\0')) {
    problems.push('Student number is required and must be 30 characters or fewer.');
  } else {
    if (seen.has(studentNumber)) problems.push('Student number is repeated in this file.');
    seen.add(studentNumber);
  }
  if (!fullName || fullName.length > 200 || fullName.includes('\0')) problems.push('Full name is required and must be 200 characters or fewer.');
  if (!PROGRAM.test(program)) problems.push('Program must be a code of 2 to 20 uppercase letters, digits, or hyphens.');
  if (!['ENROLLED', 'ALUMNI'].includes(status)) problems.push('Status must be ENROLLED or ALUMNI.');
  if (status === 'ENROLLED' && yearLevel === null) problems.push('Enrolled year level must be a whole number from 1 to 6.');
  if (status === 'ALUMNI' && !blank(rawYear)) problems.push('Leave year level blank for alumni.');
  if (status === 'ENROLLED' && blank(rawDate)) problems.push('Valid until is required for enrolled students.');
  if (!blank(rawDate) && !validUntil) problems.push('Valid until must be a valid date in MM/DD/YYYY format.');
  if (!blank(rawEmail) && (!email || email.length > 254 || email.includes('\0') || !EMAIL.test(email))) problems.push('Enter a valid email address or leave it blank.');
  if (problems.length) return { message: problems.join(' ') };

  return { person: { student_number: studentNumber, full_name: fullName, program, year_level: yearLevel, status, valid_until: validUntil, email } };
}

export async function parseRegistryFile(file, extension) {
  const [header, ...body] = await readRows(file, extension);
  const extraHeaders = header?.record.slice(HEADERS.length) ?? [];
  const hasExtraHeaders = extension === 'csv' ? extraHeaders.length > 0 : extraHeaders.some((cell) => !blank(cell));
  if (!header || hasExtraHeaders || !HEADERS.every((name, index) => name === header.record[index])) {
    throw fileError('Use the template columns in order: student_number, full_name, program, year_level, status, valid_until, email.');
  }
  const rows = body.filter(({ record }) => extension === 'xlsx' ? !record.every(blank) : record.length > 1 || !blank(record[0]));
  if (!rows.length) throw fileError('The file needs at least one data row.');
  if (rows.length > MAX_ROWS) throw tooManyRows();

  const people = [];
  const errors = [];
  const seen = new Set();
  for (const { record, row } of rows) {
    const result = checkRow(record, seen, extension);
    if (result.message) errors.push({ row, message: result.message });
    else people.push(result.person);
  }
  return { total: rows.length, people, errors };
}
