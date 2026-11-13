'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import StatusBanner from '../feedback/StatusBanner.js';
import { notify } from '../../lib/ui/notify.js';
import { listPublicOffices } from '../../lib/api/complaints.js';
import { callNextTicket, getQueueBoard, issueStaffTicket, skipQueueTicket } from '../../lib/api/queue.js';
import { formatDate, formatDateTime } from '../../lib/ui/date-format.js';
import { PRIORITY_OPTIONS, laneLabel, skipCountdown } from '../../lib/ui/queue.js';

const REFRESH_MS = 15_000;

// CC039 staff queue panel: today's queue of one office. Office Head / Office Staff see their own office; Super Admin picks one.
// Call next, Skip (3 minutes after the call) and staff issuance all run on the server, which re-checks role and office.
export default function QueuePanel({ user }) {
  const isSuperAdmin = user.role === ROLES.SUPER_ADMIN;
  const [officeId, setOfficeId] = useState(isSuperAdmin ? '' : user.officeId ?? '');
  const [offices, setOffices] = useState([]);
  // officeId: the office the data belongs to (a different one = still loading); offset: server time minus browser time, so the
  // Skip countdown follows the server's clock.
  const [board, setBoard] = useState({ officeId: null, data: null, message: null, offset: 0 });
  const [busy, setBusy] = useState(null); // 'call' | 'issue' | ticket_id
  const [priority, setPriority] = useState('');
  const [emptyNote, setEmptyNote] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isSuperAdmin) return undefined;
    let active = true;
    listPublicOffices().then((items) => active && setOffices(items)).catch(() => active && setOffices([]));
    return () => { active = false; };
  }, [isSuperAdmin]);

  const load = useCallback(async () => {
    if (!officeId) return;
    try {
      const data = await getQueueBoard(officeId);
      setBoard({ officeId, data, message: null, offset: Date.parse(data.now) - Date.now() });
    } catch (err) {
      const message = err?.status === 403 ? 'You do not have access to this office queue.' : 'The queue could not be loaded. It will try again shortly.';
      setBoard((b) => (b.officeId === officeId ? { ...b, message } : { officeId, data: null, message, offset: 0 }));
    }
  }, [officeId]);

  useEffect(() => {
    if (!officeId) return undefined;
    const first = setTimeout(load, 0);
    const refresh = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [officeId, load]);

  async function run(kind, action, success) {
    if (busy) return;
    setBusy(kind);
    setEmptyNote(false);
    try {
      const text = success(await action());
      if (text) notify.success(text);
    } catch (err) {
      notify.error(err?.code === 'SKIP_TOO_EARLY' ? 'Skip is available 3 minutes after the call.' : err?.message || 'That did not work. Please try again.');
    } finally {
      setBusy(null);
      load();
    }
  }

  const callNext = () => run('call', () => callNextTicket(officeId), (r) => {
    if (r.queue_empty) {
      setEmptyNote(true);
      return null;
    }
    return `Now calling ${r.ticket.ticket_no}`;
  });
  const issue = () => run('issue', () => issueStaffTicket({ office_id: officeId, ...(priority ? { priority_group: priority } : {}) }), (t) => `Ticket ${t.ticket_no} issued (${laneLabel(t.lane).toLowerCase()} line)`);
  const skip = (ticket) => run(ticket.ticket_id, () => skipQueueTicket(ticket.ticket_id, ticket.version), (r) => `${r.ticket.ticket_no} moved to the end of the ${laneLabel(r.ticket.lane).toLowerCase()} line`);

  const current = board.officeId === officeId;
  const data = current ? board.data : null;
  const serverNow = now + board.offset;
  return (
    <div className="space-y-4">
      {isSuperAdmin ? (
        <div className="card max-w-md p-4">
          <label className="label" htmlFor="queue-office">Office</label>
          <select id="queue-office" className="input" value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
            <option value="">Choose an office</option>
            {offices.map((o) => <option key={o.office_id} value={o.office_id}>{o.office_name}</option>)}
          </select>
        </div>
      ) : null}
      {!officeId ? <p className="text-sm text-slate-600">Choose an office to see its queue.</p> : null}
      {current && board.message ? <StatusBanner variant="error" message={board.message} /> : null}
      {officeId && !current ? <p className="text-sm text-slate-500">Loading the queue…</p> : null}
      {data ? (
        <>
          <section className="card p-5" aria-labelledby="queue-actions">
            <h2 id="queue-actions" className="mb-3 text-lg">Today, {formatDate(data.queue_date) || '-'}</h2>
            <p className="text-sm text-slate-700" data-testid="queue-counts">
              Waiting: <strong>{data.counts.waiting}</strong> ({data.counts.waiting_priority} priority) · Called: <strong>{data.counts.called}</strong> · Served: <strong>{data.counts.served}</strong>
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <button type="button" className="btn-primary" onClick={callNext} disabled={busy !== null} aria-busy={busy === 'call' || undefined}>
                {busy === 'call' ? 'Calling…' : 'Call next'}
              </button>
              <div>
                <label className="label" htmlFor="queue-priority">Issue a ticket</label>
                <div className="flex gap-2">
                  <select id="queue-priority" className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {PRIORITY_OPTIONS.map((o) => <option key={o.value || 'none'} value={o.value}>{o.value ? o.label : 'Regular line'}</option>)}
                  </select>
                  <button type="button" className="btn-secondary" onClick={issue} disabled={busy !== null}>{busy === 'issue' ? 'Issuing…' : 'Issue'}</button>
                </div>
              </div>
            </div>
            {data.queue_empty || emptyNote ? <p className="mt-3 text-sm text-slate-600" data-testid="queue-empty" aria-live="polite">No one is waiting in the queue.</p> : null}
          </section>

          <section className="card p-5" aria-labelledby="queue-called">
            <h2 id="queue-called" className="mb-3 text-lg">Called</h2>
            {data.called.length === 0 ? <p className="text-sm text-slate-600">No ticket is being called.</p> : (
              <ul className="space-y-3">
                {data.called.map((t) => {
                  const countdown = skipCountdown(t, serverNow);
                  return (
                    <li key={t.ticket_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 last:border-b-0" data-testid="called-ticket">
                      <div>
                        <p className="font-mono text-2xl font-semibold text-slate-900">{t.ticket_no}</p>
                        <p className="text-xs text-slate-600">{laneLabel(t.lane)} · called {formatDateTime(t.called_at) || '-'}{t.skip_count ? ` · skipped ${t.skip_count} time${t.skip_count === 1 ? '' : 's'}` : ''}</p>
                        <p className="text-xs text-slate-600" aria-live="polite">{countdown?.text}</p>
                      </div>
                      <button type="button" className="btn-secondary" onClick={() => skip(t)} disabled={busy !== null || !countdown?.ready}>
                        {busy === t.ticket_id ? 'Skipping…' : 'Skip (no-show)'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card p-5" aria-labelledby="queue-waiting">
            <h2 id="queue-waiting" className="mb-3 text-lg">Waiting, in call order</h2>
            {data.waiting.length === 0 ? <p className="text-sm text-slate-600">No one is waiting.</p> : (
              <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.waiting.map((t, i) => (
                  <li key={t.ticket_id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm">
                    <span><span className="mr-2 text-slate-500">{i + 1}.</span><span className="font-mono font-semibold">{t.ticket_no}</span></span>
                    <span className={t.lane === 'PRIORITY' ? 'text-xs font-semibold text-amber-800' : 'text-xs text-slate-500'}>{laneLabel(t.lane)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
