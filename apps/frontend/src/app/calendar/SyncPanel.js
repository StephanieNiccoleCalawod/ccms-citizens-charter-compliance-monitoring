'use client';

import { useCallback, useEffect, useState } from 'react';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import { apiFetch } from '../../lib/auth/session.js';
import { SYNC_LABELS } from '../../lib/api/calendar.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { ACCENTS, TONES, eventCount, systemCards } from '../../lib/ui/sync-status.js';
import { externalSystemLabel } from '../../lib/constants/brand.js';

const STATUS_CLASS = {
  FAILED: 'badge bg-red-50 text-red-700',
  ACKNOWLEDGED: 'badge bg-emerald-50 text-emerald-700',
  SENT: 'badge bg-emerald-50 text-emerald-700',
  PENDING: 'badge bg-slate-100 text-slate-600',
};

function StatusBadge({ status }) {
  return <span className={STATUS_CLASS[status] ?? 'badge bg-slate-100 text-slate-600'}>{SYNC_LABELS[status] ?? status}</span>;
}

// Cards have a border and no fill of their own, so they take the page's background.
const CARD = 'rounded-2xl border border-slate-200 bg-white';

/** One system: its name, a status badge (word + tone), one plain sentence and, when there is one, when it was last sent. */
function SystemCard({ card }) {
  return (
    <article className={`${CARD} h-full border-l-4 px-5 py-4 ${ACCENTS[card.tone]}`} data-testid={`system-${card.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-base font-bold text-slate-900">
          {card.title} <span className="font-normal text-slate-500">({card.short})</span>
        </h3>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${TONES[card.tone]}`} data-testid={`badge-${card.id}`}>{card.badge}</span>
      </div>
      <p
        className="mt-2 text-sm text-slate-700"
        data-testid={card.testId}
        {...(card.noticeState ? { role: 'alert', 'data-state': card.noticeState } : {})}
      >
        {card.text}
      </p>
      {card.lastSent ? <p className="mt-3 text-xs text-slate-500" data-testid={`last-sent-${card.id}`}>{card.lastSent}</p> : null}
    </article>
  );
}

export default function SyncPanel({ refreshKey }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [open, setOpen] = useState(false); // the Sync activity list is closed until asked for

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
  const cards = data ? systemCards(data) : [];

  return (
    <section className="space-y-4" aria-labelledby="sync-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sync-heading" className="text-2xl">
            Connected systems
          </h2>
          <p className="mt-1 text-sm text-slate-500">These are separate systems. CCCMS sends them the campus calendar.</p>
        </div>
        <button type="button" className="btn-secondary bg-transparent px-4 py-1.5" onClick={load}>
          Refresh
        </button>
      </div>
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: null }))} />
      {state.loading ? (
        <p className="text-sm text-slate-500" role="status">Loading connected systems…</p>
      ) : data ? (
        <>
          <div className="grid items-stretch gap-3 lg:grid-cols-2" data-testid="system-columns">
            {cards.map((card) => (
              <SystemCard key={card.id} card={card} />
            ))}
          </div>

          <section className={CARD} aria-labelledby="sync-activity">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <h3 id="sync-activity" className="text-sm font-bold text-slate-900">Sync activity</h3>
              <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600" data-testid="event-count">{eventCount(data.recent)}</span>
              <button type="button" className="text-sm font-semibold text-red-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700" aria-expanded={open} aria-controls="sync-activity-list" onClick={() => setOpen((v) => !v)}>
                {open ? 'Hide' : 'Show'}
              </button>
            </div>
            {open ? (
              <div id="sync-activity-list" className="border-t border-slate-200 p-4">
                <TableShell>
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
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  );
}
