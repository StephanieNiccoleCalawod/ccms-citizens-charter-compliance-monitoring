'use client';

import { useCallback, useEffect, useState } from 'react';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import { apiFetch } from '../../lib/auth/session.js';
import { SYNC_LABELS, smsSyncNotice } from '../../lib/api/calendar.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { EXTERNAL_SYSTEMS, externalSystemLabel } from '../../lib/constants/brand.js';

const STATUS_CLASS = {
  FAILED: 'badge bg-red-50 text-red-700',
  ACKNOWLEDGED: 'badge bg-emerald-50 text-emerald-700',
  SENT: 'badge bg-emerald-50 text-emerald-700',
  PENDING: 'badge bg-slate-100 text-slate-600',
};

function StatusBadge({ status }) {
  return <span className={STATUS_CLASS[status] ?? 'badge bg-slate-100 text-slate-600'}>{SYNC_LABELS[status] ?? status}</span>;
}

export default function SyncPanel({ refreshKey }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/calendar/sync/status');
      setState({ loading: false, data, error: null });
    } catch (err) {
      setState((current) => ({ ...current, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const { data } = state;
  const push = data?.fms_last_push ?? null;
  const smsReceivedAt = data?.sms_last_received ?? data?.audit_last_synced ?? null;
  const smsNotice = smsSyncNotice(data);

  return (
    <section className="card p-4" aria-labelledby="sync-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sync-heading" className="text-xl">
          Connected systems
        </h2>
        <button type="button" className="btn-secondary px-3 py-1.5" onClick={load}>
          Refresh
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-500">These are separate systems. CCCMS sends them the campus calendar.</p>
      <div className="mt-3">
        <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: null }))} />
      </div>
      {state.loading ? (
        <p className="mt-3 text-sm text-slate-500">Loading connected systems…</p>
      ) : data ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <p className="text-sm text-slate-700" data-testid="audit-sync">
              {smsReceivedAt ? `${EXTERNAL_SYSTEMS.SMS.label} last received data: ${formatDateTime(smsReceivedAt) || '-'} (Asia/Manila)` : `${EXTERNAL_SYSTEMS.SMS.label} has not received data yet`}
            </p>
            <p className="text-sm text-slate-700" data-testid="fms-push">
              {push ? (
                <>
                  Last sent to the {EXTERNAL_SYSTEMS.FMS.label}: <StatusBadge status={push.status} /> <span className="text-slate-500">{formatDateTime(push.at) || '-'} (Asia/Manila)</span>
                </>
              ) : (
                `Nothing has been sent to the ${EXTERNAL_SYSTEMS.FMS.label} yet`
              )}
            </p>
          </div>
          {smsNotice ? (
            <p className="mt-2 text-sm font-semibold text-red-700" role="alert" data-testid="sms-notice" data-state={smsNotice.state}>
              {smsNotice.text}
            </p>
          ) : null}
          {push?.status === 'FAILED' ? (
            <p className="mt-2 text-sm font-semibold text-red-700">The last data sent to the Faculty Management System (FMS) failed. It will be retried automatically; your changes are saved.</p>
          ) : null}
          <TableShell className="mt-4">
            <Table
              busy={state.loading}
              head={
                <tr>
                  <Th>External system</Th>
                  <Th>Event</Th>
                  <Th>Status</Th>
                  <Th>Last synced</Th>
                  <Th align="right">Attempts</Th>
                </tr>
              }
            >
                {data.recent.length === 0 ? (
                  <tr>
                    <td className="td text-slate-500" colSpan={5}>
                      No changes have been shared yet.
                    </td>
                  </tr>
                ) : (
                  data.recent.map((row) => (
                    <tr key={row.sync_id} className={`tr-row ${row.status === 'FAILED' ? 'bg-red-50' : ''}`}>
                      <td className="td font-semibold">
                        {externalSystemLabel(row.consumer_system)} <span className="badge bg-slate-100 text-slate-600">External system</span>
                      </td>
                      <td className="td">{row.event_type}</td>
                      <td className="td">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="td">{formatDateTime(row.last_synced_at) || '-'}</td>
                      <td className="td text-right">{row.attempts}</td>
                    </tr>
                  ))
                )}
            </Table>
          </TableShell>
        </>
      ) : null}
    </section>
  );
}
