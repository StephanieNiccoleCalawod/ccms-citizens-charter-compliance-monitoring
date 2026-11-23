'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ROLES } from 'ccms-shared/roles';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import StatusBanner from '../feedback/StatusBanner.js';
import Button from '../ui/Button.js';
import LoadingState from '../ui/LoadingState.js';
import StatusBadge from '../ui/StatusBadge.js';
import { listPublicOffices } from '../../lib/api/complaints.js';
import { listCounters } from '../../lib/api/operations.js';
import {
  callNextTicket,
  getQueueBoard,
  issueStaffTicket,
  skipQueueTicket,
} from '../../lib/api/queue.js';
import { formatDate, formatDateTime } from '../../lib/ui/date-format.js';
import { notify } from '../../lib/ui/notify.js';
import {
  PRIORITY_OPTIONS,
  buildSampleQueueBoard,
  deriveOfficeCounterMeta,
  laneLabel,
  shortOfficeName,
  skipCountdown,
} from '../../lib/ui/queue.js';

const REFRESH_MS = 15_000;
const PRIORITY_GROUPS_ONLY = PRIORITY_OPTIONS.filter((o) => Boolean(o.value));

/**
 * CC039 Queue Management module:
 * - State A (Landing Page): Active Service Counter Office selector, ticket prefix / counter window / routing policy metadata,
 *   Quick jump office shortcuts, and Counter Console Ready 4-column office availability grid.
 * - State B (Active Office Queue Console): Waiting / Called / Served summary KPI cards, Queue Operations & Ticket Issuance bar,
 *   side-by-side Called / Now Serving and Waiting, in call order panels, and collapsible Recently Served & Skipped No-Show Log.
 */
export default function QueuePanel({ user }) {
  const isSuperAdmin = user.role === ROLES.SUPER_ADMIN;
  const [officeId, setOfficeId] = useState(isSuperAdmin ? '' : user.officeId ?? '');
  const [offices, setOffices] = useState([]);
  const [counters, setCounters] = useState([]);
  const [selectedWindow, setSelectedWindow] = useState('');

  // Live board state from GET /api/operations/queue?office_id=
  const [board, setBoard] = useState({ officeId: null, data: null, message: null, offset: 0 });
  const [busy, setBusy] = useState(null); // 'call' | 'issue' | ticket_id

  // Ticket issuance controls
  const [lineType, setLineType] = useState('REGULAR'); // 'REGULAR' | 'PRIORITY'
  const [priorityGroup, setPriorityGroup] = useState('SENIOR_CITIZEN');
  const [visitorNote, setVisitorNote] = useState('');
  const [ticketNotes, setTicketNotes] = useState({}); // { [ticket_no]: string }

  // Confirmation dialogs & collapsible log
  const [confirmSkipTarget, setConfirmSkipTarget] = useState(null);
  const [confirmReinstateTarget, setConfirmReinstateTarget] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyByOffice, setHistoryByOffice] = useState({}); // { [officeId]: Array }
  const [emptyNote, setEmptyNote] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Isolated client-side sample queue preview (never mutates backend records)
  const [demoByOffice, setDemoByOffice] = useState({}); // { [officeId]: { board, history } }

  useEffect(() => {
    let active = true;
    listPublicOffices()
      .then((items) => {
        if (active) setOffices(Array.isArray(items) ? items : []);
      })
      .catch(() => {
        if (active) setOffices([]);
      });

    listCounters(isSuperAdmin ? undefined : user.officeId)
      .then((res) => {
        if (active) setCounters(Array.isArray(res?.items) ? res.items : []);
      })
      .catch(() => {
        if (active) setCounters([]);
      });

    return () => {
      active = false;
    };
  }, [isSuperAdmin, user.officeId]);

  const activeOfficeIndex = useMemo(() => {
    if (!officeId) return 0;
    const idx = offices.findIndex((o) => o.office_id === officeId);
    return idx >= 0 ? idx : 0;
  }, [offices, officeId]);

  const activeOffice = useMemo(() => {
    if (!officeId) return offices[0] ?? null;
    return (
      offices.find((o) => o.office_id === officeId) ?? {
        office_id: officeId,
        office_code: 'DESK',
        office_name: 'Assigned Office',
        is_active: true,
      }
    );
  }, [offices, officeId]);

  const activeMeta = useMemo(
    () => deriveOfficeCounterMeta(activeOffice, activeOfficeIndex, counters),
    [activeOffice, activeOfficeIndex, counters],
  );

  const activeWindowLabel = useMemo(() => {
    if (
      selectedWindow
      && activeMeta.activeCounters.some((c) => c.label === selectedWindow)
    ) {
      return selectedWindow;
    }
    return activeMeta.counterWindow;
  }, [selectedWindow, activeMeta]);

  const load = useCallback(async () => {
    if (!officeId) return;
    try {
      const data = await getQueueBoard(officeId);
      setBoard({
        officeId,
        data,
        message: null,
        offset: Date.parse(data.now) - Date.now(),
      });
      setNow(Date.now());
    } catch (err) {
      const message = err?.status === 403
        ? 'You do not have access to this office queue.'
        : 'The queue could not be loaded. It will try again shortly.';
      setBoard((b) => (
        b.officeId === officeId
          ? { ...b, message }
          : { officeId, data: null, message, offset: 0 }
      ));
    }
  }, [officeId]);

  useEffect(() => {
    if (!officeId) return undefined;
    // A hidden tab does not poll; coming back refreshes at once when the board is older than one interval.
    const visible = () => document.visibilityState !== 'hidden';
    let lastLoad = Date.now();
    const run = () => { lastLoad = Date.now(); return load(); };
    const first = setTimeout(run, 0);
    const refresh = setInterval(() => { if (visible()) run(); }, REFRESH_MS);
    const onVisible = () => { if (visible() && Date.now() - lastLoad >= REFRESH_MS) run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [officeId, load]);

  function selectOffice(nextOfficeId) {
    setOfficeId(nextOfficeId);
    setSelectedWindow('');
    setEmptyNote(false);
  }

  function appendHistory(targetOfficeId, entry) {
    setHistoryByOffice((prev) => {
      const currentList = prev[targetOfficeId] ?? [];
      return {
        ...prev,
        [targetOfficeId]: [entry, ...currentList].slice(0, 30),
      };
    });
  }

  const demoEntry = officeId ? demoByOffice[officeId] ?? null : null;
  const isDemoActive = Boolean(demoEntry);

  function handleLoadSampleQueue() {
    const targetOffice = officeId
      ? activeOffice
      : offices[0] ?? {
          office_id: 'demo-office-acad',
          office_code: 'PUP-ACAD',
          office_name: 'Campus Academic Office',
          is_active: true,
        };
    const targetId = targetOffice.office_id;
    if (!officeId && targetId) {
      setOfficeId(targetId);
    }
    const sample = buildSampleQueueBoard(targetOffice, Date.now());
    const notesPatch = {};
    for (const t of [...sample.board.called, ...sample.board.waiting]) {
      if (t.note) notesPatch[t.ticket_no] = t.note;
    }
    setTicketNotes((prev) => ({ ...prev, ...notesPatch }));
    setDemoByOffice((prev) => ({ ...prev, [targetId]: sample }));
    notify.success(`Loaded sample queue for ${targetOffice.office_name}.`);
  }

  function handleResetEmptyState() {
    if (officeId && demoByOffice[officeId]) {
      setDemoByOffice((prev) => {
        const next = { ...prev };
        delete next[officeId];
        return next;
      });
      notify.success('Exited sample preview and restored live queue state.');
      load();
      return;
    }
    setDemoByOffice({});
    setEmptyNote(false);
    if (officeId) load();
  }

  async function run(kind, action, success) {
    if (busy) return;
    setBusy(kind);
    setEmptyNote(false);
    try {
      const text = success(await action());
      if (text) notify.success(text);
    } catch (err) {
      notify.error(
        err?.code === 'SKIP_TOO_EARLY'
          ? 'Skip is available 3 minutes after the call.'
          : err?.message || 'That did not work. Please try again.',
      );
    } finally {
      setBusy(null);
      load();
    }
  }

  function callNext() {
    if (!officeId) return;
    if (isDemoActive) {
      const currentDemo = demoByOffice[officeId];
      const waitingList = [...(currentDemo?.board?.waiting ?? [])];
      const calledList = [...(currentDemo?.board?.called ?? [])];
      const prevServed = Number(currentDemo?.board?.counts?.served ?? 0);
      if (waitingList.length === 0) {
        setEmptyNote(true);
        return;
      }
      const nextTicket = {
        ...waitingList.shift(),
        status: 'CALLED',
        called_at: new Date().toISOString(),
        skippable_at: new Date(Date.now() - 1000).toISOString(),
        can_skip: true,
        call_count: 1,
      };
      const completedFromCall = calledList.map((c) => ({
        id: `demo-served-${c.ticket_id}-${Date.now()}`,
        ticket_id: c.ticket_id,
        ticket_no: c.ticket_no,
        lane: c.lane,
        action: 'SERVED',
        timestamp: new Date().toISOString(),
        note: ticketNotes[c.ticket_no] || c.note || 'Completed at counter',
      }));
      const nextCalled = [nextTicket];
      const nextServed = prevServed + calledList.length;
      setDemoByOffice((prev) => ({
        ...prev,
        [officeId]: {
          board: {
            ...currentDemo.board,
            called: nextCalled,
            waiting: waitingList,
            counts: {
              waiting: waitingList.length,
              waiting_priority: waitingList.filter((t) => t.lane === 'PRIORITY').length,
              called: nextCalled.length,
              served: nextServed,
            },
            queue_empty: waitingList.length === 0,
          },
          history: [...completedFromCall, ...(currentDemo.history ?? [])],
        },
      }));
      notify.success(`Now calling ${nextTicket.ticket_no}`);
      return;
    }

    run(
      'call',
      () => callNextTicket(officeId),
      (r) => {
        if (r.queue_empty) {
          setEmptyNote(true);
          return null;
        }
        return `Now calling ${r.ticket.ticket_no}`;
      },
    );
  }

  function issue() {
    if (!officeId) return;
    const trimmedNote = visitorNote.trim();
    const effectivePriority = lineType === 'PRIORITY' ? (priorityGroup || 'SENIOR_CITIZEN') : '';

    if (isDemoActive) {
      const currentDemo = demoByOffice[officeId];
      const lane = effectivePriority ? 'PRIORITY' : 'REGULAR';
      const seq = (currentDemo.board.waiting.length + currentDemo.board.called.length + currentDemo.board.counts.served + 2);
      const ticketNo = `${activeMeta.shortCode}-${String(seq).padStart(3, '0')}`;
      const newTicket = {
        ticket_id: `demo-issued-${Date.now()}`,
        ticket_no: ticketNo,
        office_id: officeId,
        lane,
        status: 'WAITING',
        queue_date: currentDemo.board.queue_date,
        issued_at: new Date().toISOString(),
        called_at: null,
        skippable_at: null,
        can_skip: false,
        call_count: 0,
        skip_count: 0,
        version: 1,
        note: trimmedNote || null,
      };
      if (trimmedNote) {
        setTicketNotes((prev) => ({ ...prev, [ticketNo]: trimmedNote }));
      }
      setVisitorNote('');
      const mergedWaiting = [...currentDemo.board.waiting, newTicket].sort((a, b) => (
        a.lane === b.lane ? 0 : a.lane === 'PRIORITY' ? -1 : 1
      ));
      setDemoByOffice((prev) => ({
        ...prev,
        [officeId]: {
          ...currentDemo,
          board: {
            ...currentDemo.board,
            waiting: mergedWaiting,
            counts: {
              ...currentDemo.board.counts,
              waiting: mergedWaiting.length,
              waiting_priority: mergedWaiting.filter((t) => t.lane === 'PRIORITY').length,
            },
            queue_empty: false,
          },
        },
      }));
      notify.success(`Ticket ${ticketNo} issued (${laneLabel(lane).toLowerCase()} line)`);
      return;
    }

    run(
      'issue',
      () => issueStaffTicket({
        office_id: officeId,
        ...(effectivePriority ? { priority_group: effectivePriority } : {}),
      }),
      (t) => {
        if (trimmedNote && t?.ticket_no) {
          setTicketNotes((prev) => ({ ...prev, [t.ticket_no]: trimmedNote }));
        }
        setVisitorNote('');
        return `Ticket ${t.ticket_no} issued (${laneLabel(t.lane).toLowerCase()} line)`;
      },
    );
  }

  function skipConfirmed(ticket) {
    if (!ticket || !officeId) return;
    setConfirmSkipTarget(null);

    if (isDemoActive) {
      const currentDemo = demoByOffice[officeId];
      const nextCalled = currentDemo.board.called.filter((c) => c.ticket_id !== ticket.ticket_id);
      const skippedTicket = {
        ...ticket,
        status: 'WAITING',
        called_at: null,
        skippable_at: null,
        can_skip: false,
        skip_count: Number(ticket.skip_count ?? 0) + 1,
      };
      const nextWaiting = [...currentDemo.board.waiting, skippedTicket].sort((a, b) => (
        a.lane === b.lane ? 0 : a.lane === 'PRIORITY' ? -1 : 1
      ));
      const logEntry = {
        id: `demo-skip-${ticket.ticket_id}-${Date.now()}`,
        ticket_id: ticket.ticket_id,
        ticket_no: ticket.ticket_no,
        lane: ticket.lane,
        action: 'SKIPPED',
        timestamp: new Date().toISOString(),
        note: ticketNotes[ticket.ticket_no] || ticket.note || 'Skipped (no-show)',
      };
      setDemoByOffice((prev) => ({
        ...prev,
        [officeId]: {
          board: {
            ...currentDemo.board,
            called: nextCalled,
            waiting: nextWaiting,
            counts: {
              ...currentDemo.board.counts,
              called: nextCalled.length,
              waiting: nextWaiting.length,
              waiting_priority: nextWaiting.filter((t) => t.lane === 'PRIORITY').length,
            },
            queue_empty: nextWaiting.length === 0,
          },
          history: [logEntry, ...(currentDemo.history ?? [])],
        },
      }));
      notify.success(`${ticket.ticket_no} moved to the end of the ${laneLabel(ticket.lane).toLowerCase()} line`);
      return;
    }

    run(
      ticket.ticket_id,
      () => skipQueueTicket(ticket.ticket_id, ticket.version),
      (r) => {
        appendHistory(officeId, {
          id: `skip-${r.ticket.ticket_id}-${Date.now()}`,
          ticket_id: r.ticket.ticket_id,
          ticket_no: r.ticket.ticket_no,
          lane: r.ticket.lane,
          action: 'SKIPPED',
          timestamp: new Date().toISOString(),
          note: ticketNotes[r.ticket.ticket_no] || 'Moved to tail of lane after no-show',
        });
        return `${r.ticket.ticket_no} moved to the end of the ${laneLabel(r.ticket.lane).toLowerCase()} line`;
      },
    );
  }

  function reinstateConfirmed(entry) {
    if (!entry || !officeId) return;
    setConfirmReinstateTarget(null);

    if (isDemoActive) {
      const currentDemo = demoByOffice[officeId];
      const alreadyWaiting = currentDemo.board.waiting.some((t) => t.ticket_no === entry.ticket_no);
      const nextHistory = (currentDemo.history ?? []).map((h) => (
        h.id === entry.id ? { ...h, action: 'REINSTATED' } : h
      ));
      let nextWaiting = [...currentDemo.board.waiting];
      if (!alreadyWaiting) {
        nextWaiting.push({
          ticket_id: entry.ticket_id || `demo-reinstated-${Date.now()}`,
          ticket_no: entry.ticket_no,
          office_id: officeId,
          lane: entry.lane || 'REGULAR',
          status: 'WAITING',
          queue_date: currentDemo.board.queue_date,
          issued_at: new Date().toISOString(),
          called_at: null,
          skippable_at: null,
          can_skip: false,
          call_count: 1,
          skip_count: 1,
          version: 2,
          note: entry.note,
        });
        nextWaiting = nextWaiting.sort((a, b) => (
          a.lane === b.lane ? 0 : a.lane === 'PRIORITY' ? -1 : 1
        ));
      }
      setDemoByOffice((prev) => ({
        ...prev,
        [officeId]: {
          board: {
            ...currentDemo.board,
            waiting: nextWaiting,
            counts: {
              ...currentDemo.board.counts,
              waiting: nextWaiting.length,
              waiting_priority: nextWaiting.filter((t) => t.lane === 'PRIORITY').length,
            },
            queue_empty: nextWaiting.length === 0,
          },
          history: nextHistory,
        },
      }));
      notify.success(`${entry.ticket_no} reinstated in the waiting queue.`);
      return;
    }

    setHistoryByOffice((prev) => ({
      ...prev,
      [officeId]: (prev[officeId] ?? []).map((h) => (
        h.id === entry.id ? { ...h, action: 'REINSTATED' } : h
      )),
    }));
    notify.success(`${entry.ticket_no} is active in the waiting queue.`);
    load();
  }

  const current = isDemoActive || board.officeId === officeId;
  const data = isDemoActive ? demoEntry.board : (board.officeId === officeId ? board.data : null);
  const serverNow = now + (isDemoActive ? 0 : board.offset);

  // The once-a-second redraw is only needed while a called ticket is counting down to "Skip available".
  const countdownPending = Boolean(data?.called?.some((t) => t?.skippable_at && Date.parse(t.skippable_at) > serverNow));
  useEffect(() => {
    if (!countdownPending) return undefined;
    const tick = setInterval(() => { if (document.visibilityState !== 'hidden') setNow(Date.now()); }, 1000);
    return () => clearInterval(tick);
  }, [countdownPending]);

  const officeHistory = useMemo(() => {
    if (!officeId) return [];
    if (isDemoActive) return demoEntry?.history ?? [];
    const recorded = historyByOffice[officeId] ?? [];
    const skippedInWaiting = (data?.waiting ?? [])
      .filter((t) => Number(t.skip_count) > 0 && !recorded.some((r) => r.ticket_no === t.ticket_no))
      .map((t) => ({
        id: `board-skip-${t.ticket_id}`,
        ticket_id: t.ticket_id,
        ticket_no: t.ticket_no,
        lane: t.lane,
        action: 'SKIPPED',
        timestamp: t.issued_at,
        note: ticketNotes[t.ticket_no] || `Skipped ${t.skip_count} time${t.skip_count === 1 ? '' : 's'} (re-queued)`,
      }));
    return [...recorded, ...skippedInWaiting];
  }, [officeId, isDemoActive, demoEntry, historyByOffice, data?.waiting, ticketNotes]);

  const regularWaiting = data
    ? Math.max(0, Number(data.counts.waiting ?? 0) - Number(data.counts.waiting_priority ?? 0))
    : 0;

  return (
    <div className="space-y-4" data-testid="queue-management">
      {/* Top Status & Demo Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {officeId && activeOffice ? (
            <span
              data-testid="queue-active-office-pill"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#F3C5C5] bg-[#FDF2F2] px-3 py-1 font-sans text-xs font-semibold text-[#800000]"
            >
              <span className="font-bold">{activeMeta.shortCode}</span>
              <span>&middot;</span>
              <span>{activeOffice.office_name}</span>
            </span>
          ) : null}

          {isSuperAdmin && officeId ? (
            <button
              type="button"
              data-testid="queue-back-offices"
              onClick={() => selectOffice('')}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 font-sans text-xs font-semibold text-[#202938] transition-colors hover:border-[#800000] hover:text-[#800000] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]"
            >
              <span aria-hidden="true">&larr;</span>
              <span>All Offices</span>
            </button>
          ) : null}
        </div>

        <div
          data-testid="queue-state-controls"
          className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 shadow-2xs"
        >
          <span className="font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
            Queue State:
          </span>
          <button
            type="button"
            data-testid="queue-demo-load"
            onClick={handleLoadSampleQueue}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#800000] px-3 py-1.5 font-sans text-xs font-semibold text-white transition-colors hover:bg-[#600000] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]"
          >
            <span>Demo: Load Sample Queue</span>
          </button>
          <button
            type="button"
            data-testid="queue-demo-reset"
            onClick={handleResetEmptyState}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 font-sans text-xs font-semibold text-[#202938] transition-colors hover:bg-[#F8FAFC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]"
          >
            <span>Reset Empty State</span>
          </button>
        </div>
      </div>

      {isDemoActive ? (
        <StatusBanner
          variant="warning"
          message={`Sample Queue Preview Active for ${activeOffice?.office_name || 'Selected Office'}: actions in this preview do not modify live production queue records. Click "Reset Empty State" to return to live data.`}
        />
      ) : null}

      {/* Active Service Counter Office Selection Card */}
      <section
        aria-label="Active service counter office"
        data-testid="queue-office-selector-card"
        className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xs"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="w-full lg:max-w-md">
            <label
              htmlFor={isSuperAdmin ? 'queue-office' : undefined}
              className="block font-sans text-[11px] font-bold uppercase tracking-wider text-[#64748B]"
            >
              Active Service Counter Office
            </label>

            {isSuperAdmin ? (
              <div className="mt-1.5">
                <select
                  id="queue-office"
                  data-testid="queue-office-select"
                  className="input select-chevron font-sans text-sm font-medium text-[#202938]"
                  value={officeId}
                  onChange={(e) => selectOffice(e.target.value)}
                >
                  <option value="">Choose an office...</option>
                  {offices.map((o) => (
                    <option key={o.office_id} value={o.office_id}>
                      {o.office_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="mt-1.5 flex items-center gap-2.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2">
                <span className="inline-flex items-center rounded border border-[#F3C5C5] bg-[#FDF2F2] px-2 py-0.5 font-sans text-xs font-bold text-[#800000]">
                  {activeMeta.shortCode}
                </span>
                <span className="font-sans text-sm font-semibold text-[#202938]">
                  {activeOffice?.office_name || 'Assigned Office'}
                </span>
              </div>
            )}
          </div>

          {/* Ticket Prefix, Counter Window, Routing Policy Metadata Box */}
          <div
            data-testid="queue-office-meta"
            className="grid grid-cols-3 divide-x divide-[#E2E8F0] rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-2.5 text-left"
          >
            <div className="px-3">
              <span className="block font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                Ticket Prefix
              </span>
              <span className="mt-0.5 block font-sans text-xs font-bold tabular-nums text-[#202938] sm:text-sm">
                {activeMeta.ticketPrefix}
              </span>
            </div>

            <div className="px-3">
              <span className="block font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                Counter Window
              </span>
              {activeMeta.activeCounters.length > 1 ? (
                <select
                  aria-label="Select counter window"
                  value={activeWindowLabel}
                  onChange={(e) => setSelectedWindow(e.target.value)}
                  className="mt-0.5 block w-full cursor-pointer bg-transparent font-sans text-xs font-bold text-[#202938] focus:outline-none sm:text-sm"
                >
                  {activeMeta.activeCounters.map((c) => (
                    <option key={c.counter_id} value={c.label}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="mt-0.5 block truncate font-sans text-xs font-bold text-[#202938] sm:text-sm">
                  {activeWindowLabel}
                </span>
              )}
            </div>

            <div className="px-3">
              <span className="block font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                Routing Policy
              </span>
              <span className="mt-0.5 inline-flex items-center gap-1 font-sans text-xs font-bold text-[#B45309] sm:text-sm">
                <span aria-hidden="true">&#8645;</span>
                <span>{activeMeta.routingPolicy}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Quick Office Selection Shortcuts (Super Admin) */}
        {isSuperAdmin && offices.length > 0 ? (
          <div
            data-testid="queue-quick-jump"
            className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[#E2E8F0] pt-3.5"
          >
            <span className="mr-1 font-sans text-xs font-medium text-[#64748B]">
              Quick jump:
            </span>
            {offices.map((o, idx) => {
              const meta = deriveOfficeCounterMeta(o, idx, counters);
              const selected = o.office_id === officeId;
              return (
                <button
                  key={o.office_id}
                  type="button"
                  data-testid={`queue-quick-jump-${meta.shortCode}`}
                  onClick={() => selectOffice(o.office_id)}
                  className={`cursor-pointer rounded-lg border px-2.5 py-1 font-sans text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] ${
                    selected
                      ? 'border-[#800000] bg-[#FDF2F2] font-semibold text-[#800000]'
                      : 'border-[#E2E8F0] bg-[#F8FAFC] font-medium text-[#202938] hover:border-[#800000] hover:bg-[#FDF2F2]/50 hover:text-[#800000]'
                  }`}
                >
                  {shortOfficeName(o.office_name, o.office_code)}
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      {/* STATE A: Queue Management Landing Page (No Office Selected Yet) */}
      {!officeId ? (
        <section
          aria-labelledby="queue-landing-heading"
          data-testid="queue-landing-card"
          className="rounded-xl border border-[#E2E8F0] bg-white p-6 shadow-2xs"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#F3C5C5] bg-[#FDF2F2] px-3 py-1 font-sans text-xs font-semibold text-[#800000]">
            <span>Counter Console Ready</span>
          </span>

          <h2
            id="queue-landing-heading"
            className="mt-3 font-sans text-xl font-bold text-[#202938]"
          >
            Choose an office to open its live counter queue
          </h2>
          <p className="mt-1 max-w-2xl font-sans text-sm text-[#64748B]">
            Select any PUP Quezon City service desk below to view waiting visitors, call the next ticket number, or issue a walk-in queue slip.
          </p>

          <div
            data-testid="queue-office-grid"
            className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {offices.map((o, idx) => {
              const meta = deriveOfficeCounterMeta(o, idx, counters);
              return (
                <button
                  key={o.office_id}
                  type="button"
                  data-testid={`queue-office-card-${meta.shortCode}`}
                  onClick={() => selectOffice(o.office_id)}
                  className="group flex h-full cursor-pointer flex-col justify-between rounded-xl border border-[#E2E8F0] bg-white p-4 text-left transition-colors hover:border-[#800000] hover:bg-[#FDF2F2]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center rounded-md border border-[#F3C5C5] bg-[#FDF2F2] px-2 py-0.5 font-sans text-[11px] font-bold tracking-wide text-[#800000]">
                        {meta.shortCode}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-sans text-[11px] font-semibold ${
                          meta.ready
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-slate-100 text-slate-600'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 rounded-full ${
                            meta.ready ? 'bg-emerald-500' : 'bg-slate-400'
                          }`}
                        />
                        <span>{meta.ready ? 'Ready' : 'Unavailable'}</span>
                      </span>
                    </div>

                    <h3 className="mt-3 font-sans text-sm font-bold leading-snug text-[#202938] group-hover:text-[#800000]">
                      {o.office_name}
                    </h3>
                    <p className="mt-1 font-sans text-xs text-[#64748B]">
                      {meta.counterWindow}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-[#E2E8F0] pt-3 font-sans text-xs font-semibold text-[#202938] group-hover:text-[#800000]">
                    <span>Open counter console</span>
                    <span aria-hidden="true">&rarr;</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Error & Loading States */}
      {officeId && !isDemoActive && current && board.message ? (
        <StatusBanner variant="error" message={board.message} />
      ) : null}
      {officeId && !current ? (
        <LoadingState>Loading the queue…</LoadingState>
      ) : null}

      {/* STATE B: Active Office Queue Console */}
      {officeId && data ? (
        <>
          {/* 1. Queue Summary KPI Cards (Waiting, Called, Served) */}
          <section
            aria-label="Queue summary"
            className="grid gap-4 sm:grid-cols-3"
            data-testid="queue-counts"
          >
            {/* Waiting Card */}
            <div className="flex items-start justify-between rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xs">
              <div>
                <span className="block font-sans text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                  Waiting
                </span>
                <p
                  data-testid="queue-count-waiting"
                  className="mt-1 font-sans text-3xl font-bold tabular-nums text-[#202938]"
                >
                  {data.counts.waiting}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 font-sans text-xs">
                  <span className="inline-flex items-center rounded-md border border-[#E2E8F0] bg-[#F4F5F8] px-2 py-0.5 font-semibold tabular-nums text-[#202938]">
                    {data.counts.waiting_priority} priority
                  </span>
                  <span className="text-[#64748B]">&middot; {regularWaiting} regular</span>
                </div>
              </div>
              <div
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#F0DDB0] bg-[#FFFBEB] text-[#D97706]"
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7.5" cy="6.5" r="2.5" />
                  <path d="M3 15.5c0-2.2 2-4 4.5-4s4.5 1.8 4.5 4" />
                  <circle cx="14" cy="7.5" r="2" />
                  <path d="M13.5 11.8c2 .2 3.5 1.7 3.5 3.7" />
                </svg>
              </div>
            </div>

            {/* Called Card */}
            <div className="flex items-start justify-between rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xs">
              <div>
                <span className="block font-sans text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                  Called
                </span>
                <p
                  data-testid="queue-count-called"
                  className="mt-1 font-sans text-3xl font-bold tabular-nums text-[#800000]"
                >
                  {data.counts.called}
                </p>
                <p className="mt-2 font-sans text-xs text-[#64748B]">
                  {data.called.length > 0
                    ? `Now serving ${data.called[0].ticket_no} (${activeWindowLabel})`
                    : 'Counter currently idle'}
                </p>
              </div>
              <div
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#F3C5C5] bg-[#FDF2F2] text-[#800000]"
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 11V9a1 1 0 0 1 1-1h2.5L12 4.5v11L6.5 12H4a1 1 0 0 1-1-1Z" />
                  <path d="M14.5 7.5a3.5 3.5 0 0 1 0 5" />
                </svg>
              </div>
            </div>

            {/* Served Card */}
            <div className="flex items-start justify-between rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xs">
              <div>
                <span className="block font-sans text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                  Served
                </span>
                <p
                  data-testid="queue-count-served"
                  className="mt-1 font-sans text-3xl font-bold tabular-nums text-emerald-700"
                >
                  {data.counts.served}
                </p>
                <p className="mt-2 font-sans text-xs text-[#64748B]">
                  Completed today ({formatDate(data.queue_date) || '-'})
                </p>
              </div>
              <div
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700"
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="10" cy="10" r="7" />
                  <path d="m7 10 2 2 4-4" />
                </svg>
              </div>
            </div>
          </section>

          {/* 2. Queue Operations and Ticket Issuance Bar */}
          <section
            aria-label="Queue operations and ticket issuance"
            data-testid="queue-operations-card"
            className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xs"
          >
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              {/* Left Section: Today status & Call Next Ticket */}
              <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between xl:pr-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-sans text-base font-bold text-[#202938]">
                      Today, {formatDate(data.queue_date) || '-'}
                    </h2>
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-sans text-xs font-semibold ${
                        data.queue_empty
                          ? 'border-[#E2E8F0] bg-[#F4F5F8] text-[#475569]'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {data.queue_empty ? 'Queue empty' : `${data.counts.waiting} waiting`}
                    </span>
                  </div>

                  {data.queue_empty || emptyNote ? (
                    <p
                      className="mt-1 font-sans text-xs text-[#64748B]"
                      data-testid="queue-empty"
                      aria-live="polite"
                    >
                      No one is waiting in the queue. Issue a walk-in ticket to begin.
                    </p>
                  ) : (
                    <p className="mt-1 font-sans text-xs text-[#64748B]" aria-live="polite">
                      Next in call order:{' '}
                      <span className="font-bold text-[#202938]">{data.waiting[0]?.ticket_no}</span>{' '}
                      ({laneLabel(data.waiting[0]?.lane)} lane).
                    </p>
                  )}
                </div>

                <Button
                  data-testid="queue-call-next"
                  onClick={callNext}
                  disabled={busy !== null}
                  loading={busy === 'call'}
                  loadingLabel="Calling…"
                  className={
                    data.queue_empty
                      ? 'border border-[#E2E8F0] bg-[#F4F5F8] text-[#475569] hover:bg-[#E2E8F0]/60'
                      : ''
                  }
                >
                  Call Next Ticket
                </Button>
              </div>

              {/* Divider on desktop */}
              <div aria-hidden="true" className="hidden h-14 w-px bg-[#E2E8F0] xl:block" />

              {/* Right Section: Issue a Ticket */}
              <div className="flex flex-col gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 sm:flex-row sm:flex-wrap sm:items-end">
                {/* Line Type Segmented Toggle */}
                <div>
                  <span className="block font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                    Issue a Ticket &middot; Line Type
                  </span>
                  <div className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-[#F4F5F8] p-1">
                    <button
                      type="button"
                      data-testid="queue-line-regular"
                      onClick={() => setLineType('REGULAR')}
                      className={`cursor-pointer rounded-md px-3 py-1 font-sans text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] ${
                        lineType === 'REGULAR'
                          ? 'bg-white font-semibold text-[#202938] shadow-2xs'
                          : 'font-medium text-[#64748B] hover:text-[#202938]'
                      }`}
                    >
                      Regular Line
                    </button>
                    <button
                      type="button"
                      data-testid="queue-line-priority"
                      onClick={() => setLineType('PRIORITY')}
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 font-sans text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] ${
                        lineType === 'PRIORITY'
                          ? 'border border-[#F0DDB0] bg-[#FFFBEB] font-semibold text-[#92400E] shadow-2xs'
                          : 'font-medium text-[#64748B] hover:text-[#202938]'
                      }`}
                    >
                      <span>Priority (SC/PWD)</span>
                    </button>
                  </div>
                </div>

                {/* Statutory Priority Category Selector when Priority is chosen */}
                {lineType === 'PRIORITY' ? (
                  <div className="w-full sm:w-44">
                    <label
                      htmlFor="queue-priority"
                      className="block font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]"
                    >
                      Priority Category
                    </label>
                    <select
                      id="queue-priority"
                      data-testid="queue-priority-select"
                      value={priorityGroup}
                      onChange={(e) => setPriorityGroup(e.target.value)}
                      className="input select-chevron mt-1.5 h-9 py-1 font-sans text-xs"
                    >
                      {PRIORITY_GROUPS_ONLY.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {/* Service / Visitor Note (Optional) */}
                <div className="min-w-[13rem] flex-1">
                  <label
                    htmlFor="queue-visitor-note"
                    className="block font-sans text-[10px] font-bold uppercase tracking-wider text-[#64748B]"
                  >
                    Service / Visitor Note (Optional)
                  </label>
                  <input
                    id="queue-visitor-note"
                    data-testid="queue-visitor-note"
                    type="text"
                    maxLength={80}
                    value={visitorNote}
                    onChange={(e) => setVisitorNote(e.target.value)}
                    placeholder="e.g., Grade Correction / TOR..."
                    className="input mt-1.5 h-9 py-1 font-sans text-xs"
                  />
                </div>

                <Button
                  data-testid="queue-issue-btn"
                  onClick={issue}
                  disabled={busy !== null}
                  loading={busy === 'issue'}
                  loadingLabel="Issuing…"
                >
                  Issue Ticket
                </Button>
              </div>
            </div>
          </section>

          {/* 3 & 4. Side-by-Side Called / Now Serving & Waiting Queue Panels */}
          <div className="grid gap-4 lg:grid-cols-12">
            {/* Left: Called / Now Serving Panel */}
            <section
              aria-labelledby="queue-called-heading"
              data-testid="queue-called-panel"
              className="flex flex-col rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xs lg:col-span-5"
            >
              <div className="flex items-center justify-between gap-2 pb-4">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 rounded-full ${
                      data.called.length > 0 ? 'bg-[#800000]' : 'bg-slate-300'
                    }`}
                  />
                  <h2 id="queue-called-heading" className="font-sans text-sm font-bold text-[#202938]">
                    Called / Now Serving
                  </h2>
                </div>
                <span className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-0.5 font-sans text-xs font-medium text-[#64748B]">
                  {activeWindowLabel}
                </span>
              </div>

              {data.called.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC]/60 px-6 py-12 text-center">
                  <div
                    aria-hidden="true"
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E2E8F0] bg-white text-[#64748B]"
                  >
                    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="8" cy="7" r="3" />
                      <path d="M3 16c0-2.5 2.2-4.5 5-4.5" />
                      <circle cx="14.5" cy="13.5" r="2.5" />
                      <path d="m16.5 15.5 2 2" />
                    </svg>
                  </div>
                  <p className="mt-3 font-sans text-sm font-bold text-[#202938]">
                    No ticket is being called
                  </p>
                  <p className="mt-1 font-sans text-xs text-[#64748B]">
                    {data.waiting.length === 0
                      ? 'Waiting queue is currently empty.'
                      : 'Select "Call Next Ticket" above to call the next waiting visitor.'}
                  </p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {data.called.map((t) => {
                    const countdown = skipCountdown(t, serverNow);
                    const noteText = ticketNotes[t.ticket_no] || t.note || null;
                    const canSkipNow = isDemoActive || Boolean(countdown?.ready);
                    return (
                      <li
                        key={t.ticket_id}
                        data-testid="called-ticket"
                        className="rounded-xl border border-[#F3C5C5] bg-[#FDF2F2]/40 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-sans text-2xl font-bold tabular-nums text-[#800000]">
                                {t.ticket_no}
                              </span>
                              <StatusBadge variant={t.lane === 'PRIORITY' ? 'priority' : 'regular'}>
                                {laneLabel(t.lane)}
                              </StatusBadge>
                            </div>
                            {noteText ? (
                              <p className="mt-1 font-sans text-xs font-semibold text-[#202938]">
                                {noteText}
                              </p>
                            ) : null}
                            <p className="mt-1 font-sans text-xs text-[#64748B]">
                              Called {formatDateTime(t.called_at) || '-'}
                              {t.skip_count
                                ? ` · skipped ${t.skip_count} time${t.skip_count === 1 ? '' : 's'}`
                                : ''}
                            </p>
                            {countdown?.text ? (
                              <p className="mt-0.5 font-sans text-xs text-[#64748B]" aria-live="polite">
                                {countdown.text}
                              </p>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              data-testid="queue-skip-btn"
                              onClick={() => setConfirmSkipTarget(t)}
                              disabled={busy !== null || !canSkipNow}
                              loading={busy === t.ticket_id}
                              loadingLabel="Skipping…"
                            >
                              Skip (no-show)
                            </Button>
                            {!isDemoActive ? (
                              <Link
                                href="/transactions/new"
                                className="btn btn-primary btn-sm"
                              >
                                Start Transaction
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Right: Waiting, in call order Panel */}
            <section
              aria-labelledby="queue-waiting-heading"
              data-testid="queue-waiting-panel"
              className="flex flex-col rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xs lg:col-span-7"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
                <div className="flex items-center gap-2">
                  <h2 id="queue-waiting-heading" className="font-sans text-sm font-bold text-[#202938]">
                    Waiting, in call order
                  </h2>
                  <span className="inline-flex items-center rounded-full border border-[#E2E8F0] bg-[#F4F5F8] px-2 py-0.5 font-sans text-xs font-bold tabular-nums text-[#202938]">
                    {data.waiting.length}
                  </span>
                </div>
                <span className="inline-flex items-center gap-1 font-sans text-xs font-medium text-[#B45309]">
                  <span aria-hidden="true">&#8645;</span>
                  <span>Priority tickets auto-route to top</span>
                </span>
              </div>

              {data.waiting.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC]/60 px-6 py-12 text-center">
                  <div
                    aria-hidden="true"
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E2E8F0] bg-white text-[#64748B]"
                  >
                    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 11V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5" />
                      <path d="M3.5 11h13v3H3.5z" />
                      <path d="M5 14v2.5M15 14v2.5" />
                    </svg>
                  </div>
                  <p className="mt-3 font-sans text-sm font-bold text-[#202938]">
                    No one is waiting
                  </p>
                  <p className="mt-1 max-w-md font-sans text-xs text-[#64748B]">
                    Issue a walk-in ticket using the control bar above, or load a sample queue to preview priority call ordering.
                  </p>
                </div>
              ) : (
                <ol className="grid gap-2.5 sm:grid-cols-2">
                  {data.waiting.map((t, i) => {
                    const noteText = ticketNotes[t.ticket_no] || t.note || null;
                    return (
                      <li
                        key={t.ticket_id}
                        data-testid="waiting-ticket"
                        className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-3 transition-colors hover:border-slate-300"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-[#F4F5F8] px-1.5 font-sans text-xs font-bold tabular-nums text-[#475569]">
                              {i + 1}
                            </span>
                            <span className="font-sans text-sm font-bold tabular-nums text-[#202938]">
                              {t.ticket_no}
                            </span>
                            {t.skip_count > 0 ? (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-amber-800">
                                Re-queued
                              </span>
                            ) : null}
                          </div>
                          {noteText ? (
                            <p className="mt-1 truncate font-sans text-xs text-[#64748B]">
                              {noteText}
                            </p>
                          ) : null}
                        </div>
                        <StatusBadge variant={t.lane === 'PRIORITY' ? 'priority' : 'regular'}>
                          {laneLabel(t.lane)}
                        </StatusBadge>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>

          {/* 5. Collapsible Recently Served & Skipped No-Show Log */}
          <section
            aria-label="Recently served and skipped no-show log"
            data-testid="queue-history-section"
            className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-2xs"
          >
            <button
              type="button"
              data-testid="queue-history-toggle"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((open) => !open)}
              className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[#F8FAFC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]"
            >
              <div className="flex items-center gap-2.5">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="h-4 w-4 text-[#64748B]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3.5 10a6.5 6.5 0 1 0 2-4.6" />
                  <path d="M3.5 3.5v3h3" />
                  <path d="M10 6.5V10l2.5 1.5" />
                </svg>
                <span className="font-sans text-xs font-bold text-[#202938]">
                  Recently Served &amp; Skipped No-Show Log
                </span>
                <span className="inline-flex items-center rounded-full border border-[#E2E8F0] bg-[#F4F5F8] px-2 py-0.5 font-sans text-[11px] font-bold tabular-nums text-[#475569]">
                  {officeHistory.length}
                </span>
              </div>

              <div className="flex items-center gap-2 font-sans text-xs text-[#64748B]">
                <span>Reinstate skipped visitors if they return</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className={`h-4 w-4 transition-transform ${historyOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m5 8 5 5 5-5" />
                </svg>
              </div>
            </button>

            {historyOpen ? (
              <div
                data-testid="queue-history-panel"
                className="border-t border-[#E2E8F0] bg-[#F8FAFC] px-5 py-4"
              >
                {officeHistory.length === 0 ? (
                  <p className="font-sans text-xs text-[#64748B]">
                    No served or skipped no-show tickets logged in this session yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-[#E2E8F0] rounded-xl border border-[#E2E8F0] bg-white">
                    {officeHistory.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="font-sans text-sm font-bold tabular-nums text-[#202938]">
                            {item.ticket_no}
                          </span>
                          <StatusBadge variant={item.lane === 'PRIORITY' ? 'priority' : 'regular'}>
                            {laneLabel(item.lane)}
                          </StatusBadge>
                          <StatusBadge
                            variant={
                              item.action === 'SERVED'
                                ? 'success'
                                : item.action === 'REINSTATED'
                                  ? 'info'
                                  : 'warning'
                            }
                          >
                            {item.action === 'SERVED'
                              ? 'Served'
                              : item.action === 'REINSTATED'
                                ? 'Reinstated'
                                : 'Skipped (No-Show)'}
                          </StatusBadge>
                          {item.note ? (
                            <span className="font-sans text-xs text-[#64748B]">
                              &middot; {item.note}
                            </span>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-3">
                          {item.timestamp ? (
                            <span className="font-sans text-xs text-[#64748B]">
                              {formatDateTime(item.timestamp)}
                            </span>
                          ) : null}
                          {item.action === 'SKIPPED' ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              data-testid={`queue-reinstate-${item.ticket_no}`}
                              onClick={() => setConfirmReinstateTarget(item)}
                            >
                              Reinstate
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {/* Confirmation Dialog for Skip (No-Show) */}
      <ConfirmDialog
        open={Boolean(confirmSkipTarget)}
        title="Skip no-show ticket?"
        message={
          confirmSkipTarget
            ? `Mark ${confirmSkipTarget.ticket_no} as a no-show and move it to the end of the ${laneLabel(confirmSkipTarget.lane).toLowerCase()} waiting line?`
            : ''
        }
        confirmLabel="Skip Ticket"
        onConfirm={() => skipConfirmed(confirmSkipTarget)}
        onCancel={() => setConfirmSkipTarget(null)}
      />

      {/* Confirmation Dialog for Reinstate */}
      <ConfirmDialog
        open={Boolean(confirmReinstateTarget)}
        title="Reinstate skipped visitor?"
        message={
          confirmReinstateTarget
            ? `Confirm that visitor ${confirmReinstateTarget.ticket_no} has returned to the counter and keep their ticket active in the waiting queue?`
            : ''
        }
        confirmLabel="Confirm Reinstate"
        onConfirm={() => reinstateConfirmed(confirmReinstateTarget)}
        onCancel={() => setConfirmReinstateTarget(null)}
      />
    </div>
  );
}
