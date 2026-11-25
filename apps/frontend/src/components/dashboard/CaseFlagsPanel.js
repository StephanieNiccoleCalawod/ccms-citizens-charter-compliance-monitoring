'use client';

import Link from 'next/link';
import { FLAG_TEXT, holdMinutesText, lowRatingRows, scopedCaseFlags, starsText } from '../../lib/ui/case-flags.js';
import { formatDate } from '../../lib/ui/date-format.js';
import Card from '../ui/Card.js';
import DataTable from '../ui/DataTable.js';
import StatusBadge from '../ui/StatusBadge.js';

const nameOf = (id, map, fallback) => map?.[id] ?? fallback ?? '-';

/** Flags 4 to 6 under Unusual Delays: long holds, many cancelled or auto-closed, and services rated low. Each list appears only when it has something. */
export default function CaseFlagsPanel({ overview, ratings = [], names = {}, scope = { kind: 'campus', officeId: null } }) {
  const { holds, cancellations } = scopedCaseFlags(overview, scope);
  const low = lowRatingRows(ratings, scope);
  if (!holds.length && !cancellations.length && !low.length) return null;
  const holdCols = [
    { key: 'tracking_no', header: 'Transaction', render: (r) => (r.can_open ? <Link href={`/transactions/${encodeURIComponent(r.transaction_id)}`} className="row-action px-0 font-mono">{r.tracking_no}</Link> : <span className="font-mono">{r.tracking_no}</span>) },
    { key: 'service', header: 'Service', render: (r) => nameOf(r.service_id, names.services, r.service_code) },
    { key: 'held', header: 'On hold', align: 'right', render: (r) => holdMinutesText(r.held_minutes) },
  ];
  const cancelRows = cancellations.flatMap((o) => o.days.map((d) => ({ ...d, office_id: o.office_id, usual_max: o.usual_max })));
  const cancelCols = [
    { key: 'office', header: 'Office', render: (r) => nameOf(r.office_id, names.offices) },
    { key: 'day', header: 'Day', render: (r) => formatDate(r.day) },
    { key: 'n', header: 'Cancelled or auto-closed', align: 'right', render: (r) => r.cancelled },
    { key: 'usual', header: 'Usual at most', align: 'right', render: (r) => r.usual_max },
  ];
  const lowCols = [
    { key: 'service', header: 'Service', render: (r) => r.service_name },
    { key: 'avg', header: 'Average', align: 'right', render: (r) => starsText(r.average) },
    { key: 'count', header: 'Ratings', align: 'right', render: (r) => r.count },
  ];
  const block = (id, title, note, table) => (
    <section aria-labelledby={`flags-${id}`} data-testid={`flags-${id}`}>
      <div className="flex items-center gap-2"><h4 id={`flags-${id}`} className="title-card">{title}</h4><StatusBadge variant="warning">Flag</StatusBadge></div>
      <p className="mt-0.5 text-xs text-[#64748B]">{note}</p>
      <div className="mt-2">{table}</div>
    </section>
  );
  return (
    <Card as="section" aria-label="Other cases to look at" padding="md" className="space-y-5 sm:p-6" data-testid="insights-case-flags">
      <h3 className="font-serif text-2xl font-normal leading-tight text-[#202938]">Other cases to look at</h3>
      {holds.length ? block('holds', FLAG_TEXT.HOLD_LONG, 'Held for more than one working day in total.', <DataTable label={FLAG_TEXT.HOLD_LONG} columns={holdCols} data={holds} keyExtractor={(r) => r.transaction_id} minWidth="28rem" />) : null}
      {cancelRows.length ? block('cancelled', FLAG_TEXT.MANY_CANCELLED, 'Compared with the office’s own usual days. Checked only for offices with at least 20 working days of records.', <DataTable label={FLAG_TEXT.MANY_CANCELLED} columns={cancelCols} data={cancelRows} keyExtractor={(r) => `${r.office_id}|${r.day}`} minWidth="30rem" />) : null}
      {low.length ? block('rating', FLAG_TEXT.LOW_RATING, 'Services with at least 10 ratings. This is satisfaction, not timeliness.', <DataTable label={FLAG_TEXT.LOW_RATING} columns={lowCols} data={low} keyExtractor={(r) => r.service_id} minWidth="24rem" />) : null}
    </Card>
  );
}
