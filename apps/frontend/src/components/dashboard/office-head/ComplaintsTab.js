'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listComplaintsForStaff } from '../../../lib/api/complaint-handling.js';
import { STATUS_LABEL } from '../../../lib/ui/complaint-handling.js';
import { formatDateTime } from '../../../lib/ui/date-format.js';
import DataTable from '../../ui/DataTable.js';
import StatCard from '../../ui/StatCard.js';
import StatusBadge from '../../ui/StatusBadge.js';

const LOG_PAGE_SIZE = 10;

/** Hours since due_at, for an overdue complaint's status pill ("Overdue (78h)"). null when not computable. */
function overdueHours(row) {
  if (!row?.overdue || !row.due_at) return null;
  const ms = Date.now() - new Date(row.due_at).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 3_600_000) : null;
}

function StatusCell({ row }) {
  const hours = overdueHours(row);
  if (hours !== null) return <StatusBadge variant="danger">Overdue ({hours}h)</StatusBadge>;
  if (row.status === 'ACKNOWLEDGED') return <StatusBadge variant="warning">{STATUS_LABEL.ACKNOWLEDGED}</StatusBadge>;
  if (row.status === 'RESOLVED') return <StatusBadge variant="success">{STATUS_LABEL.RESOLVED}</StatusBadge>;
  return <StatusBadge variant="neutral">{STATUS_LABEL[row.status] ?? row.status}</StatusBadge>;
}

/** Tab 5: the same complaint counts Office Home has always shown (getComplaintSummary), plus a real recent-complaints log. */
export default function ComplaintsTab({ complaintsState }) {
  const { loading, data, error } = complaintsState;
  const [log, setLog] = useState({ loading: true, items: [], error: '' });

  useEffect(() => {
    if (data?.restricted) return undefined;
    let active = true;
    listComplaintsForStaff({ page: 1, pageSize: LOG_PAGE_SIZE })
      .then((result) => { if (active) setLog({ loading: false, items: result?.items ?? [], error: '' }); })
      .catch((failure) => { if (active) setLog({ loading: false, items: [], error: failure?.message || 'The complaints log could not be loaded.' }); });
    return () => { active = false; };
  }, [data?.restricted]);

  if (error) return <p className="text-sm text-slate-600" data-testid="office-head-complaints">{error}</p>;
  if (data?.restricted) {
    return (
      <p className="text-sm text-slate-600" data-testid="office-head-complaints">
        Complaints summary is hidden under current staff permissions.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="office-head-complaints">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Open Complaints"
          value={loading && !data ? '-' : (data?.open ?? 0)}
          note={data ? `${data.received} received · ${data.acknowledged} acknowledged` : ''}
          className="h-full justify-between p-5"
        />
        <StatCard
          label="Overdue Response"
          value={loading && !data ? '-' : (data?.overdue ?? 0)}
          tone={data?.overdue ? 'danger' : 'default'}
          note="Past ARTA’s initial-response limit"
          className="h-full justify-between p-5"
        />
        <StatCard
          label="Acknowledged"
          value={loading && !data ? '-' : (data?.acknowledged ?? 0)}
          note="Under investigation"
          className="h-full justify-between p-5"
        />
        <StatCard
          label="Resolved (Period)"
          value={loading && !data ? '-' : (data?.resolved ?? 0)}
          note="Closed in the selected period"
          className="h-full justify-between p-5"
        />
      </div>

      <section className="card space-y-4 p-5 sm:p-6" aria-labelledby="office-head-complaints-log-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="office-head-complaints-log-heading" className="title-card">Office Citizen Complaints &amp; Feedback Log</h2>
            <p className="mt-1 text-xs text-ink-muted sm:text-sm">ARTA-mandated 72-hour initial resolution tracking for your office.</p>
          </div>
          <Link href="/complaints" className="text-xs font-semibold text-pup-maroon hover:underline">
            View all complaints &rarr;
          </Link>
        </div>

        <DataTable
          label="Office citizen complaints and feedback log"
          columns={[
            { key: 'id', header: 'Complaint ID', render: (row) => <span className="td-id">{row.reference}</span> },
            { key: 'category', header: 'Category', render: (row) => <span className="td-medium">{row.category_label ?? '-'}</span> },
            {
              key: 'summary',
              header: 'Summary / Related Tracking #',
              render: (row) => (
                <div className="max-w-xs whitespace-normal">
                  <span className="block truncate" title={row.description || ''}>{row.description || '-'}</span>
                  {row.tracking_no ? <span className="td-secondary tabular-nums">Tracking: {row.tracking_no}</span> : null}
                </div>
              ),
            },
            { key: 'filed', header: 'Filed', className: 'tabular-nums', render: (row) => formatDateTime(row.created_at) },
            { key: 'status', header: 'Status', render: (row) => <StatusCell row={row} /> },
            {
              key: 'action',
              header: 'Action',
              align: 'right',
              render: (row) => {
                const actionable = row.status !== 'RESOLVED' && overdueHours(row) !== null;
                return (
                  <Link href={`/complaints?open=${encodeURIComponent(row.complaint_id)}`} className="row-action">
                    {actionable ? 'Respond' : 'Open'} &rarr;
                  </Link>
                );
              },
            },
          ]}
          data={log.items}
          keyExtractor={(row) => row.complaint_id}
          loading={log.loading}
          loadingMessage="Loading complaints…"
          error={log.error}
          emptyIcon="inbox"
          emptyTitle="No Complaints Yet"
          emptyMessage="No citizen complaints have been recorded for your office."
          minWidth="48rem"
        />
        <p className="border-t border-line pt-3 text-xs text-ink-muted">Due times follow ARTA&rsquo;s mandated response window.</p>
      </section>
    </div>
  );
}
