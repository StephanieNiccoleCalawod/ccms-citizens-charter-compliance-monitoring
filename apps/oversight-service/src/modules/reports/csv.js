// CSV export of a report (CC029 AC4, J-02): UTF-8 with a byte-order mark so Excel reads accents correctly, one row per service
// plus a total row, dates as MM/DD/YYYY. Text cells that could be read as a formula are prefixed with an apostrophe.
export const BOM = '﻿';

export const usDate = (isoDate) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? ''));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
};

const PERIOD_LABEL = { weekly: 'Weekly', monthly: 'Monthly', half_year: 'Half-year', annual: 'Annual', custom: 'Custom' };
const STATUS_LABEL = { DRAFT: 'Draft', PUBLISHED: 'Published', SUPERSEDED: 'Superseded' };

export function cell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const HEAD = [
  'Office', 'Period', 'From', 'To', 'Version', 'Status', 'Service', 'Received', 'On time', 'Late (including closed automatically)',
  'Closed automatically', 'On-time rate (%)', 'Cancelled', 'Pending now', 'Not in registry', 'Backdated', 'Started outside hours',
  'Average working minutes', 'Median working minutes', '90th percentile working minutes',
  // CC040: separate from compliance. Empty in a report generated before CC040 (its frozen figures have no queue_wait).
  'Queue waits measured', 'Average queue wait (minutes)',
];

function row(report, label, b) {
  const r = b.results ?? {};
  return [
    report.office_name ?? '', PERIOD_LABEL[report.period_type] ?? report.period_type, usDate(report.from), usDate(report.to), report.version,
    STATUS_LABEL[report.status] ?? report.status, label, b.received, r.on_time, r.late_total, r.late_auto_closed, r.on_time_rate,
    b.cancelled, b.pending?.count, b.not_in_registry, b.backdated, b.started_outside_hours,
    b.time?.average_minutes, b.time?.median_minutes, b.time?.p90_minutes,
    b.queue_wait?.measured, b.queue_wait?.average_minutes,
  ];
}

/** `report` is the DTO of reports.js (from/to as YYYY-MM-DD). */
export function reportToCsv(report) {
  const figures = report.figures ?? {};
  const lines = [HEAD, ...(figures.services ?? []).map((s) => row(report, s.service_name ?? 'Service (name not available)', s)), row(report, 'Total (all services)', figures.total ?? {})];
  return BOM + lines.map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n';
}
