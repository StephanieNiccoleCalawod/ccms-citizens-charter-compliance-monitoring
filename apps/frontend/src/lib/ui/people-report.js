// S8-54: the "Reports by person" panel (office, one person, or every staff member of an office). The figures come from
// GET /api/operations/reports/people; nothing here recalculates them. Who may see what is decided by the server (D-AC-6):
// the Super Admin any office, an Office Head their own office and staff, Office Staff their own report only.
import { ROLES } from 'ccms-shared/roles';
import { formatDate, formatDateRange } from './date-format.js';
import { minutesText } from './insights.js';

export const SCOPES = Object.freeze([
  { value: 'office', label: 'Whole office' },
  { value: 'all_staff', label: 'Every staff member (one row each)' },
  { value: 'person', label: 'One person' },
]);

export const SEED_NOTE = 'Practice data added for the demo is left out of these figures.';
export const COMPLAINTS_NOTE = 'Complaints linked to each person are not available yet.';
export const COMPLAINTS_LINKED_NOTE = 'Complaints are counted when they name the tracking number of a transaction the person started.';
/** The note under the table: the real rule when Oversight answered, the "not available" line when it did not. */
export const complaintsNote = (report) => (report?.totals?.linked_complaints == null ? COMPLAINTS_NOTE : COMPLAINTS_LINKED_NOTE);

/** The scopes this role may ask for. Office Staff only ever get their own report. */
export function scopesFor(role) {
  if (role === ROLES.OFFICE_STAFF) return SCOPES.filter((s) => s.value === 'person');
  if (role === ROLES.SUPER_ADMIN || role === ROLES.OFFICE_HEAD) return [...SCOPES];
  return [];
}

export const canSeePeopleReport = (role) => scopesFor(role).length > 0;

/** The query for the request, or { error } when something is missing. Dates are Manila calendar dates (YYYY-MM-DD). */
export function buildPeopleQuery({ role, scope, officeId, personId, from, to, user }) {
  const own = role === ROLES.OFFICE_STAFF;
  const office = role === ROLES.SUPER_ADMIN ? officeId : user?.officeId;
  if (!office) return { error: 'Choose an office.' };
  if (!from || !to) return { error: 'Choose the first and last date.' };
  if (from > to) return { error: 'The first date must not be after the last date.' };
  const chosen = own ? 'person' : scope;
  if (chosen === 'person' && !own && !personId) return { error: 'Choose a person.' };
  return { scope: chosen, officeId: office, personId: chosen === 'person' ? (own ? user.id : personId) : undefined, from, to };
}

export function peopleFailureMessage(failure) {
  const status = failure?.status;
  if (status === 403) return 'You are not allowed to see this report.';
  if (status === 400 || status === 422) return 'Check the office, person and dates, then try again.';
  if (failure?.code === 'REPORT_MEMBERSHIP_UNAVAILABLE' || status === 503) return 'The list of staff could not be checked right now. Nothing was changed. Please try again.';
  return 'The report could not be loaded right now. Please try again.';
}

const count = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-PH') : '-');
const percent = (p) => (p === null || p === undefined ? 'No rate yet' : `${Number(p).toLocaleString('en-PH', { maximumFractionDigits: 1 })}%`);

/** One table row from an item or from the totals. */
export function peopleRow(item, { total = false } = {}) {
  const m = item ?? {};
  return {
    key: total ? 'total' : (m.person_id ?? 'other'),
    label: total ? 'All together' : (m.person_name || 'Name not available'),
    handled: count(m.handled),
    onTime: `${count(m.on_time)} (${percent(m.on_time_percent)})`,
    late: count(m.late),
    typical: m.median_working_minutes == null ? '-' : minutesText(m.median_working_minutes),
    paused: Number(m.paused_minutes) > 0 ? minutesText(m.paused_minutes) : '-',
    autoClosed: count(m.auto_closed),
    cancelled: count(m.cancelled),
    open: count(m.open),
    rating: m.rating_average == null ? '-' : `${Number(m.rating_average).toFixed(1)} (${count(m.rating_count)})`,
    complaints: m.linked_complaints == null ? '-' : count(m.linked_complaints),
  };
}

export function peopleRows(report) {
  if (!report) return [];
  const people = Array.isArray(report.items) ? report.items : [];
  const rows = people.map((p) => peopleRow(p));
  if (report.scope === 'all_staff' || report.scope === 'office') rows.push(peopleRow(report.totals, { total: true }));
  return rows;
}

export const peopleScopeText = (report, officeName, personName) => {
  if (report?.scope === 'person') return `${personName || 'One person'}, ${officeName || 'office'}`;
  if (report?.scope === 'all_staff') return `Every staff member, ${officeName || 'office'}`;
  return officeName || 'Office';
};

export const PEOPLE_HEADINGS = ['Handled', 'Finished on time', 'Finished late', 'Typical processing time', 'Paused time', 'Closed automatically', 'Cancelled', 'Open now', 'Rating (answers)', 'Complaints'];

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** The same rows as the table: plain headings, one header row, MM/DD/YYYY dates, UTF-8 with a byte-order mark. */
export function peopleCsv(report) {
  const header = ['Person', ...PEOPLE_HEADINGS, 'From', 'To'];
  const lines = peopleRows(report).map((r) => [r.label, r.handled, r.onTime, r.late, r.typical, r.paused, r.autoClosed, r.cancelled, r.open, r.rating, r.complaints, formatDate(report.from), formatDate(report.to)]);
  return `﻿${[header, ...lines].map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** 'CCCMS_Report_Registrars_Office_11252026.csv' (S8-55): the office and the day it was made. */
export function reportCsvName(officeName, madeOn) {
  const clean = String(officeName || 'Office').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Office';
  const day = formatDate(madeOn).replaceAll('/', '');
  return `CCCMS_Report_${clean}${day ? `_${day}` : ''}.csv`;
}

export const periodSentence = (from, to) => formatDateRange(from, to);
