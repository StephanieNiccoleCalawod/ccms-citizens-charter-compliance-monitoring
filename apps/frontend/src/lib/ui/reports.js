// Rules for the Reports page (CC029 / CC030 / CC031), as pure functions (no React, no network, no clock).
import { ROLES } from 'ccms-shared/roles';
import { formatDate, formatDateTime } from './date-format.js';

export const PERIOD_TYPES = Object.freeze([
  { value: 'half_year', label: 'Half-year' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'annual', label: 'Annual' },
  { value: 'custom', label: 'Custom dates' },
]);
export const DEFAULT_PERIOD_TYPE = 'half_year';
export const STATUS_LABEL = Object.freeze({ DRAFT: 'Draft', PUBLISHED: 'Published', SUPERSEDED: 'Superseded' });
export const REASON_MAX = 500;

export const periodTypeLabel = (value) => PERIOD_TYPES.find((p) => p.value === value)?.label ?? value;
export const periodText = (report) => `${formatDate(report?.from)} to ${formatDate(report?.to)}`;
export const versionText = (report) => `Version ${report?.version ?? '-'}`;

/** Super Admin and Office Head generate and publish; the Executive only reads (the server enforces the same). */
export const canManageReports = (role) => role === ROLES.SUPER_ADMIN || role === ROLES.OFFICE_HEAD;
/** Who published, shown to the Office Head and Super Admin only (the Executive's answer does not carry it). */
export const publishedByText = (report) => (report?.published_by_name ? `${report.published_by_name}, ` : '') + (report?.published_at ? formatDateTime(report.published_at) : '');

/** The body of POST /reports from the form. Dates are sent only for a custom period. */
export function buildGenerateBody({ officeId, periodType, from, to, date }) {
  const body = { officeId, periodType: periodType || DEFAULT_PERIOD_TYPE };
  if (body.periodType === 'custom') { body.from = from; body.to = to; } else if (date) body.date = date;
  return body;
}

/** Early feedback by field; the server checks again. */
export function generateErrors({ officeId, periodType, from, to }) {
  const errors = {};
  if (!officeId) errors.officeId = 'Choose an office.';
  if (periodType === 'custom') {
    if (!from) errors.from = 'Choose a start date.';
    if (!to) errors.to = 'Choose an end date.';
    if (from && to && from > to) errors.from = 'The start date must be on or before the end date.';
  }
  return errors;
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
