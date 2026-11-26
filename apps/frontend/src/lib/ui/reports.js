// Rules for the Reports page (CC029 / CC030 / CC031), as pure functions (no React, no network, no clock).
import { ROLES } from 'ccms-shared/roles';
import { formatDateRange, formatDateTime } from './date-format.js';
import { queueWaitFigure } from './queue.js';

export const PERIOD_TYPES = Object.freeze([
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'half_year', label: 'Half-year' },
  { value: 'annual', label: 'Annual' },
  { value: 'custom', label: 'Custom dates' },
]);
export const DEFAULT_PERIOD_TYPE = 'half_year';
/** The hint under "From" for a period type that is not Custom dates or a term/school year (those carry their own
 * range already): picking any date there snaps the shown From/To to the week, month, half-year or year it falls
 * in - Oversight only ever computes these four kinds of period from one such date, never an arbitrary range. */
export const PERIOD_ANCHOR_HINT = Object.freeze({
  weekly: 'Pick any date in the week; Monday–Sunday is used.',
  monthly: 'Pick any date in the month; the whole month is used.',
  half_year: 'Pick any date in the half-year; Jan–Jun or Jul–Dec is used.',
  annual: 'Pick any date in the year; the whole year is used.',
});
export const STATUS_LABEL = Object.freeze({ DRAFT: 'Draft', PUBLISHED: 'Published', SUPERSEDED: 'Superseded' });
export const REASON_MAX = 500;

/** AC-10: printed signature titles under each blank line on a report sheet. No printed names - one place to change
 * either title. "Noted by"'s title is not yet confirmed by the client, so it stays blank until it is. */
export const SIGNATURE_LINES = Object.freeze({ preparedBy: 'Office Head', notedBy: '' });

export const periodTypeLabel = (value) => PERIOD_TYPES.find((p) => p.value === value)?.label ?? value;
export const periodText = (report) => formatDateRange(report?.from, report?.to) || '-';
/** The period as the report sheet writes it: the term or school year with its dates when it was chosen that way (S8-64). */
export const periodSentence = (report) => {
  const label = report?.figures?.period_label;
  return label ? `${String(label).replace(/(\d{4})-(\d{4})/, '$1–$2')} (${periodText(report)})` : `${periodTypeLabel(report?.period_type)}, ${periodText(report)}`;
};
export const versionText = (report) => `Version ${report?.version ?? '-'}`;

/** Super Admin and Office Head generate and publish; the Executive only reads (the server enforces the same). */
export const canManageReports = (role) => role === ROLES.SUPER_ADMIN || role === ROLES.OFFICE_HEAD;
/** Who published, shown to the Office Head and Super Admin only (the Executive's answer does not carry it). */
export const publishedByText = (report) => (report?.published_by_name ? `${report.published_by_name}, ` : '') + (report?.published_at ? formatDateTime(report.published_at) : '');

/** The body of POST /reports from the form. Dates are sent only for a custom period. */
export function buildGenerateBody({ officeId, periodType, from, to, date }) {
  // S8-64: a term or a school year ("term:<code>", "year:<yyyy-yyyy>") goes as term / schoolYear; the server turns it into dates.
  if (typeof periodType === 'string' && periodType.startsWith('term:')) return { officeId, term: periodType.slice(5) };
  if (typeof periodType === 'string' && periodType.startsWith('year:')) return { officeId, schoolYear: periodType.slice(5) };
  const body = { officeId, periodType: periodType || DEFAULT_PERIOD_TYPE };
  if (body.periodType === 'custom') { body.from = from; body.to = to; } else if (date) body.date = date;
  return body;
}

/**
 * Early feedback by field, also used to disable Generate Report until the dialog is fillable; the server checks
 * again. `from`/`to` are the computed (for Weekly/Monthly/Half-year/Annual) or chosen (for Custom dates) range -
 * leave them unset when there is none yet. `dateRequired` is true for Weekly/Monthly/Half-year/Annual, where a
 * reference date is required before there is a range at all (a term or school year choice needs neither).
 */
export function generateErrors({ officeId, periodType, from, to, dateRequired = false }) {
  const errors = {};
  if (!officeId) errors.officeId = 'Choose an office.';
  if (!periodType) errors.periodType = 'Choose a period.';
  if (periodType === 'custom') {
    if (!from) errors.from = 'Choose a start date.';
    if (!to) errors.to = 'Choose an end date.';
    if (from && to && from > to) errors.from = 'The start date must be on or before the end date.';
  } else if (dateRequired && (!from || !to)) {
    errors.date = 'Choose a reference date.';
  }
  return errors;
}

const DAY_MS = 86_400_000;
const parseUTC = (date) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const formatUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date, days) => formatUTC(parseUTC(date) + days * DAY_MS);
const lastDayOfMonth = (year, month) => formatUTC(Date.UTC(year, month, 0));

/**
 * The office report's from/to for a period type and an anchor date (today, or the date someone picked) - the same
 * rule Oversight resolves server-side (periodBounds in oversight-service/analytics/period.js), kept here only so
 * the "before you generate" summary shows the exact range about to be generated. null for Custom dates or a
 * term/school year choice (those carry their own range already - see termPeriodText in term-period.js).
 */
export function periodBounds(type, anchor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor ?? '')) return null;
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  if (type === 'weekly') {
    const weekday = new Date(parseUTC(anchor)).getUTCDay(); // 0 Sunday .. 6 Saturday
    const from = addDays(anchor, -((weekday + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  if (type === 'monthly') return { from: `${anchor.slice(0, 7)}-01`, to: lastDayOfMonth(year, month) };
  if (type === 'half_year') return month <= 6 ? { from: `${year}-01-01`, to: `${year}-06-30` } : { from: `${year}-07-01`, to: `${year}-12-31` };
  if (type === 'annual') return { from: `${year}-01-01`, to: `${year}-12-31` };
  return null;
}

export function reasonError(reason) {
  const text = String(reason ?? '').trim();
  if (!text) return 'Give the reason for the correction.';
  if (text.length > REASON_MAX) return `The reason must be ${REASON_MAX} characters or fewer.`;
  return '';
}

/** What the detail view offers for a report and a role. */
export function reportActions(report, role) {
  const manage = canManageReports(role);
  return {
    publish: manage && report?.status === 'DRAFT',
    correct: manage && report?.status === 'PUBLISHED',
    csv: Boolean(report),
    print: Boolean(report),
  };
}

/** The banner on a superseded report, or on a draft that will replace one. */
export function versionBanner(report) {
  if (report?.status === 'SUPERSEDED' && report.replaced_by_version) return { kind: 'superseded', text: `Replaced by version ${report.replaced_by_version}`, targetId: report.replaced_by_report_id };
  if (report?.status === 'DRAFT' && report.supersedes_report_id) return { kind: 'correction', text: `A correction to the published version. Reason: ${report.supersede_reason ?? ''}`.trim(), targetId: report.supersedes_report_id };
  return null;
}

const num = (v) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('en-PH'));

/** The rows of the figures table: one per service, then the total. Cancelled, auto-closed and pending are their own columns. */
export function figureRows(report) {
  const toRow = (label, b, total = false) => ({
    key: total ? 'total' : b.service_id,
    label, total,
    received: num(b.received),
    onTime: num(b.results?.on_time),
    late: num(b.results?.late_total),
    closedAutomatically: num(b.results?.late_auto_closed),
    rate: b.results?.on_time_rate === null || b.results?.on_time_rate === undefined ? 'No rate yet' : `${b.results.on_time_rate}%`,
    cancelled: num(b.cancelled),
    autoClosed: num(b.auto_closed),
    pending: num(b.pending?.count),
    notInRegistry: num(b.not_in_registry),
    // CC040: its own figure, never part of the rate. '-' for a report published before CC040 (no queue_wait in its figures).
    queueWait: queueWaitFigure(b),
  });
  const f = report?.figures ?? {};
  return [...(f.services ?? []).map((s) => toRow(s.service_name ?? 'Service (name not available)', s)), toRow('Total (all services)', f.total ?? {}, true)];
}

export function failureMessage(error) {
  const code = error?.code;
  if (code === 'REPORT_ALREADY_PUBLISHED') return 'This office and period already has a published report. Open it and use "Correct with a new version".';
  if (code === 'REPORT_NOT_A_DRAFT') return 'This report is already published.';
  if (code === 'REPORT_DRAFT_EXISTS') return 'A new version is already being prepared for this period.';
  if (code === 'CORE_UNAVAILABLE') return 'The office and service names could not be loaded right now. Nothing was saved. Please try again in a few minutes.';
  if (error?.status === 403) return 'You do not have permission to do this.';
  if (error?.status === 404) return 'This report could not be found.';
  return error?.message || 'Something went wrong. Please try again in a few minutes.';
}
