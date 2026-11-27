'use client';

import { NOT_ENOUGH_RATINGS, SATISFACTION_NOTE, rateText, satisfactionRows, starsText } from '../../lib/ui/case-flags.js';
import Card from '../ui/Card.js';
import DataTable from '../ui/DataTable.js';
import StatusBadge from '../ui/StatusBadge.js';

/** Client Satisfaction: stars and number of ratings per service and office, and how many clients answered. Never mixed with timeliness. */
export default function ClientSatisfactionPanel({ ratings = [], loading = false, names = {}, scope = { kind: 'campus', officeId: null }, periodLabel = '' }) {
  const rows = satisfactionRows(ratings, scope);
  const cols = [
    { key: 'service', header: 'Service', render: (r) => <span className="td-primary">{r.service_name}</span> },
    { key: 'office', header: 'Office', render: (r) => names.offices?.[r.office_id] ?? '-' },
    { key: 'stars', header: 'Average rating', align: 'right', className: 'tabular-nums', render: (r) => (r.enough
      ? <span><span className="font-semibold">{starsText(r.average)}</span>{r.low ? <StatusBadge variant="warning" className="ml-2">Low</StatusBadge> : null}</span>
      : <span className="td-muted">{NOT_ENOUGH_RATINGS}</span>) },
    { key: 'count', header: 'Ratings', align: 'right', className: 'tabular-nums', render: (r) => r.count },
    { key: 'rate', header: 'Answered', align: 'right', className: 'tabular-nums', render: (r) => rateText(r.response_rate) },
  ];
  return (
    <Card as="section" aria-label="Client satisfaction" padding="md" className="space-y-3 sm:p-6" data-testid="insights-satisfaction">
      <div>
        <h3 className="font-serif text-2xl font-normal leading-tight text-[#202938]">Client Satisfaction</h3>
        <p className="mt-1 text-sm text-[#64748B]">{SATISFACTION_NOTE}{periodLabel ? ` ${periodLabel}.` : ''}</p>
        <p className="mt-1 text-xs text-[#64748B]">An average is shown only after 10 ratings. “Answered” is the share of rating codes that clients used.</p>
      </div>
      <DataTable
        label="Client satisfaction by service"
        columns={cols}
        data={rows}
        keyExtractor={(r) => r.service_id}
        loading={loading}
        loadingMessage="Loading ratings…"
        emptyIcon="chart"
        emptyTitle="No Ratings for This Period"
        emptyMessage="No citizen ratings were recorded during the selected reporting period."
        minWidth="40rem"
      />
    </Card>
  );
}
