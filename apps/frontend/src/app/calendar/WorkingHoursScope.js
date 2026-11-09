'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import StatusBanner from '../../components/feedback/StatusBanner.js';
import { DAY_NAMES } from '../../lib/api/calendar.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { getCampusHistory, getCampusSchedule, getOfficeSchedule, resetOfficeSchedule } from '../../lib/api/office-schedule.js';
import { apiFetch } from '../../lib/auth/session.js';
import { notify } from '../../lib/ui/notify.js';
import { CAMPUS_SCOPE, canEditOfficeSchedule, canViewOfficeSchedule, saveFailure, scopeOptions } from '../../lib/ui/office-schedule.js';
import { saveFailureMessage } from '../../lib/ui/save-feedback.js';
import { FOLLOWS_CAMPUS_NOTE, PILL_DAYS, campusRecord, officeRecord, recordCount, scheduleRows, workingDaySet } from '../../lib/ui/working-hours.js';
import WorkingHoursModal from './WorkingHoursModal.js';

// The cards have no fill of their own: a border only, so they take the page's background (light or dark).
const CARD = 'rounded-2xl border border-slate-200 bg-white';

// The two cards sit side by side from the lg size (one under the other on a smaller screen) and stretch to the same height.
const TWO_COLUMNS = 'grid items-stretch gap-4 lg:grid-cols-2';

/** The schedule as rows, one line each: the days in bold, then the hours (and the lunch). */
function ScheduleRows({ items, testId }) {
  return (
    <ul className="space-y-1.5" data-testid={testId}>
      {scheduleRows(items).map((row) => (
        <li key={`${row.days}-${row.hours}`} className="flex gap-4 text-sm text-slate-800 sm:whitespace-nowrap" data-testid="schedule-row">
          {row.days ? <span className="w-16 shrink-0 font-semibold text-slate-900">{row.days}</span> : null}
          <span>
            {row.hours}
            {row.lunch ? <span className="text-slate-500"> · {row.lunch}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CurrentSchedule({ scope, view }) {
  const days = workingDaySet(view.items);
  const follows = scope !== CAMPUS_SCOPE && view.usesCampus;
  return (
    <section className={`${CARD} flex h-full flex-col px-5 py-4`} aria-labelledby="current-schedule" data-testid="current-schedule">
      <h2 id="current-schedule" className="text-sm font-bold text-slate-900">Current schedule</h2>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Working days">
        {PILL_DAYS.map(({ dow, label }) => (
          <li key={dow} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${days.has(dow) ? 'border-green-600 bg-green-500/10 text-green-700' : 'border-slate-300 text-slate-500'}`} aria-label={`${DAY_NAMES[dow]}: ${days.has(dow) ? 'working day' : 'non-working day'}`}>
            {label}
          </li>
        ))}
      </ul>
      <div className="mt-5 space-y-2 border-t border-slate-200 pt-4" data-testid="current-schedule-text">
        {follows ? <p className="text-sm text-slate-600">{FOLLOWS_CAMPUS_NOTE}</p> : null}
        <ScheduleRows items={view.items} testId="current-schedule-rows" />
      </div>
    </section>
  );
}

function Records({ records, note, canRemove, onRemove }) {
  return (
    <section className={`${CARD} flex h-full flex-col`} aria-labelledby="records-heading" data-testid="records">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <h2 id="records-heading" className="text-sm font-bold text-slate-900">Records</h2>
        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{recordCount(records.length)}</span>
      </div>
      {records.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">{note}</p>
      ) : (
        <ul className="divide-y divide-[#EAE3D9]">
          {records.map((record) => (
            <li key={record.id} className="space-y-3 px-5 py-4" data-testid="record">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">{record.title}</p>
                  {record.added ? <p className="mt-0.5 text-xs text-slate-500">{record.added.startsWith('Version') ? record.added : `Added ${record.added}`}</p> : null}
                </div>
                <div className="flex items-center gap-4">
                  <span className="w-fit rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-800">{record.badge}</span>
                  {record.removable && canRemove ? (
                    <button type="button" className="text-sm font-semibold text-slate-700 underline hover:text-slate-900" aria-label={`Remove ${record.title}`} onClick={() => onRemove(record)}>
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
              <ScheduleRows items={record.items} />
            </li>
          ))}
        </ul>
      )}
      {note && records.length > 0 ? <p className="mt-auto border-t border-slate-200 px-5 py-3 text-xs text-slate-500">{note}</p> : null}
    </section>
  );
}

/** The current schedule and the records of one scope (the campus or an office). Keyed by scope, so a new scope loads from the start. */
function ScopeView({ scope, scopeName, canWrite, onReload }) {
  const [state, setState] = useState({ loading: true, view: null, history: [], error: null });
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const isCampus = scope === CAMPUS_SCOPE;

  const fetchView = useCallback(async () => {
    if (isCampus) {
      const [campus, history] = await Promise.all([getCampusSchedule(), canWrite ? getCampusHistory().catch(() => null) : Promise.resolve(null)]);
      return { view: { items: campus.items, usesCampus: false, version: 0 }, history: history?.items ?? null };
    }
    const [own, campus] = await Promise.all([getOfficeSchedule(scope), getCampusSchedule()]);
    return { view: { items: own.items, usesCampus: own.uses_campus_schedule, version: own.version, campusItems: campus.items }, history: [] };
  }, [scope, isCampus, canWrite]);

  useEffect(() => {
    let cancelled = false;
    fetchView()
      .then((result) => !cancelled && setState({ loading: false, view: result.view, history: result.history, error: null }))
      .catch((err) => !cancelled && setState({ loading: false, view: null, history: [], error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [fetchView]);

  async function removeOwnSchedule() {
    if (busy) return;
    setBusy(true);
    try {
      await resetOfficeSchedule(scope, state.view.version);
      setConfirm(null);
      notify.success(`${scopeName} now uses the campus schedule.`);
      onReload();
    } catch (err) {
      setConfirm(null);
      const failure = saveFailure(err);
      if (failure.kind === 'conflict') setConflict(true);
      else notify.error(saveFailureMessage(err, failure.message));
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) return <p className={`${CARD} px-5 py-6 text-sm text-slate-500`} role="status">Loading the schedule…</p>;
  if (state.error) {
    return (
      <div className={`${CARD} space-y-3 px-5 py-5`}>
        <ErrorBanner message={state.error} />
        <button type="button" className="btn-secondary bg-transparent" onClick={onReload}>Try again</button>
      </div>
    );
  }

  const { view, history } = state;
  let records;
  let note;
  if (isCampus) {
    records = (history ?? []).map((entry, index) => campusRecord(entry, { newest: index === 0 }));
    // The note is for an empty or unavailable list only; with records on screen there is nothing to explain.
    note = history === null ? (canWrite ? 'The saved versions could not be loaded.' : 'The saved versions are visible to a Super Admin.') : history.length === 0 ? 'No working-hours changes recorded yet.' : '';
  } else if (view.usesCampus) {
    records = [];
    note = `No records yet. ${scopeName} follows the campus schedule.`;
  } else {
    records = [officeRecord({ officeName: scopeName, version: view.version, items: view.items })];
    note = '';
  }

  return (
    <div className="space-y-4">
      {conflict ? (
        <div className="space-y-3" role="alert" data-testid="schedule-conflict">
          <StatusBanner variant="warning" message="This schedule was changed by someone else. Reload it to see the latest version; nothing was removed." />
          <button type="button" className="btn-primary" onClick={onReload}>Reload latest schedule</button>
        </div>
      ) : null}
      <div className={TWO_COLUMNS} data-testid="schedule-columns">
        <CurrentSchedule scope={scope} view={view} />
        <Records records={records} note={note} canRemove={canWrite && !isCampus} onRemove={(record) => setConfirm(record)} />
      </div>
      <ConfirmDialog
        open={confirm !== null}
        danger
        title="Remove this schedule?"
        message={`${scopeName} will stop using its own schedule and follow the campus working days and hours again. Results already computed are not changed; only computations made afterwards use the campus schedule.`}
        confirmLabel="Remove"
        busy={busy}
        busyLabel="Removing…"
        onConfirm={removeOwnSchedule}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/**
 * The Working hours tab: what the schedule is of (the Campus, or one office), the "Add working hours" button, the current schedule and
 * its records. Offices come from the Catalogue; an Office Head is offered only their own, and a role that may not read office schedules
 * is offered the Campus only (and so sees no selector). Only a Super Admin can add, change or remove.
 */
export default function WorkingHoursScope({ user, canWrite, onChanged }) {
  const [scope, setScope] = useState(CAMPUS_SCOPE);
  const [offices, setOffices] = useState({ items: [], error: null });
  const [adding, setAdding] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const wantsOffices = canViewOfficeSchedule(user.role); // Staff and others are offered the Campus only, so no office list is needed

  useEffect(() => {
    if (!wantsOffices) return undefined;
    let cancelled = false;
    apiFetch(OFFICES_API)
      .then((data) => !cancelled && setOffices({ items: data.items ?? [], error: null }))
      .catch((err) => !cancelled && setOffices({ items: [], error: `Offices could not be loaded: ${err.message}` }));
    return () => {
      cancelled = true;
    };
  }, [wantsOffices]);

  const options = useMemo(() => scopeOptions(user, offices.items), [user, offices.items]);
  const selected = options.find((o) => o.value === scope) ?? options[0];
  const mayEdit = canWrite && canEditOfficeSchedule(user.role);

  async function saved({ scope: savedScope, campus }) {
    setAdding(false);
    setScope(savedScope);
    setRefresh((n) => n + 1);
    if (campus) onChanged?.(); // a campus change is queued for the connected systems; the office schedule never is
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={offices.error} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        {options.length > 1 ? (
          <div className="w-full sm:w-96">
            <label className="label" htmlFor="schedule-scope">Schedule of</label>
            <select id="schedule-scope" className="input select-chevron bg-transparent" value={selected.value} onChange={(e) => setScope(e.target.value)}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm font-semibold text-slate-700">Schedule of: Campus</p>
        )}
        {mayEdit ? (
          <button type="button" className="btn-primary px-5 py-2.5" onClick={() => setAdding(true)}>
            + Add working hours
          </button>
        ) : null}
      </div>

      <ScopeView key={`${selected.value}-${refresh}`} scope={selected.value} scopeName={selected.name ?? 'Campus'} canWrite={mayEdit} onReload={() => setRefresh((n) => n + 1)} />

      {adding ? <WorkingHoursModal scopes={options} initialScope={selected.value} onClose={() => setAdding(false)} onSaved={saved} /> : null}
    </div>
  );
}
