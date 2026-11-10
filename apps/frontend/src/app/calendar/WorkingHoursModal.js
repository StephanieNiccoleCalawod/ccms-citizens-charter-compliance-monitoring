'use client';

import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import StatusBanner from '../../components/feedback/StatusBanner.js';
import { FieldError } from '../../components/forms/Field.js';
import Modal from '../../components/modals/Modal.js';
import { DAY_NAMES } from '../../lib/api/calendar.js';
import { getCampusSchedule, getOfficeSchedule, saveCampusSchedule, saveOfficeSchedule } from '../../lib/api/office-schedule.js';
import { notify } from '../../lib/ui/notify.js';
import { CAMPUS_SCOPE, inWeekOrder, sameRows, saveFailure, toDays, toRows, validateRows } from '../../lib/ui/office-schedule.js';
import { saveFailureMessage } from '../../lib/ui/save-feedback.js';
import { useSingleSubmit } from '../../lib/ui/useSingleSubmit.js';
import {
  PILL_DAYS,
  SAVE_NOTE,
  isUniform,
  setLunch,
  setShift,
  sharedError,
  sharedLunch,
  sharedShift,
  toCampusDays,
  toggleSharedLunch,
  togglePill,
} from '../../lib/ui/working-hours.js';
import ScheduleDayRow, { TimeField } from './ScheduleDayRow.js';


/**
 * "Add working hours": the weekly schedule of the campus or of one office. One shift for the working days you pick (with an optional
 * lunch break for an office), or hours set day by day. `scopes` are the choices of "Applies to"; `initialScope` is what the page was
 * showing. Saving asks first, then sends the same requests as before (campus: PUT /schedule; office: PUT with the loaded version).
 * A 409 means someone else saved first: nothing is overwritten and the person can reload the latest schedule.
 */
export default function WorkingHoursModal({ scopes, initialScope, onClose, onSaved }) {
  const run = useSingleSubmit();
  const [target, setTarget] = useState(initialScope);
  const [load, setLoad] = useState({ loading: true, error: null, version: 0, usesCampus: false, baseline: [] });
  const [rows, setRows] = useState([]);
  const [custom, setCustom] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isCampus = target === CAMPUS_SCOPE;
  const option = scopes.find((s) => s.value === target);
  const officeName = option?.name ?? 'This office';

  const fetchTarget = useCallback(async (value) => {
    if (value === CAMPUS_SCOPE) {
      const campus = await getCampusSchedule();
      return { items: campus.items, version: 0, usesCampus: false };
    }
    const [own, campus] = await Promise.all([getOfficeSchedule(value), getCampusSchedule()]);
    // An office with no schedule of its own starts from the campus hours as a draft; nothing is saved until Save & publish.
    return { items: own.uses_campus_schedule ? campus.items : own.items, version: own.version, usesCampus: own.uses_campus_schedule };
  }, []);

  const apply = useCallback((result) => {
    const next = toRows(result.items);
    setLoad({ loading: false, error: null, version: result.version, usesCampus: result.usesCampus, baseline: next });
    setRows(next);
    setCustom(!isUniform(next));
    setErrors({});
    setConflict(null);
    setSaveError(null);
  }, []);

  // The first load, for the scope the page was showing. A later choice in "Applies to" loads through changeTarget.
  useEffect(() => {
    let cancelled = false;
    fetchTarget(initialScope)
      .then((result) => !cancelled && apply(result))
      .catch((err) => !cancelled && setLoad((l) => ({ ...l, loading: false, error: err.message })));
    return () => {
      cancelled = true;
    };
  }, [fetchTarget, apply, initialScope]);

  async function changeTarget(value) {
    setTarget(value);
    setLoad((l) => ({ ...l, loading: true, error: null }));
    try {
      apply(await fetchTarget(value));
    } catch (err) {
      setLoad((l) => ({ ...l, loading: false, error: err.message }));
    }
  }

  async function reload() {
    setLoad((l) => ({ ...l, loading: true, error: null }));
    try {
      apply(await fetchTarget(target));
    } catch (err) {
      setLoad((l) => ({ ...l, loading: false, error: err.message }));
    }
  }

  const dirty = !load.loading && !sameRows(rows, load.baseline);
  const locked = load.loading || saving;
  const shift = sharedShift(rows);
  const lunch = sharedLunch(rows);
  const anyWorking = rows.some((r) => r.is_working);

  function edit(next) {
    setRows(next);
    setErrors({});
    setSaveError(null);
  }

  function changeRow(next) {
    edit(rows.map((r) => (r.day_of_week === next.day_of_week ? next : r)));
  }

  // Save & publish only checks the form and asks. Nothing is sent until the person confirms.
  function askToSave(event) {
    event?.preventDefault();
    if (locked) return;
    const problems = validateRows(rows);
    if (Object.keys(problems).length > 0) {
      setErrors(problems); // what was typed stays; nothing is sent
      notify.error(saveFailureMessage({ status: 400, details: problems }));
      return;
    }
    setConfirmOpen(true);
  }

  function failed(err) {
    const failure = saveFailure(err);
    if (failure.kind === 'conflict') {
      setConflict(failure);
      notify.error('This schedule was changed by someone else. Nothing was saved.');
    } else if (failure.kind === 'invalid') {
      setErrors(failure.fieldErrors);
      setSaveError(failure.message);
      notify.error(saveFailureMessage({ status: 400, details: failure.fieldErrors }));
    } else {
      setSaveError(failure.message);
      notify.error(saveFailureMessage(err, failure.message));
    }
  }

  const confirmSave = () =>
    run(async () => {
      setSaving(true);
      try {
        if (isCampus) await saveCampusSchedule(toCampusDays(rows));
        else await saveOfficeSchedule(target, { version: load.version, days: toDays(rows) });
        setConfirmOpen(false);
        notify.success('Working hours saved and published.');
        await onSaved({ scope: target, campus: isCampus });
      } catch (err) {
        setConfirmOpen(false);
        failed(err);
      } finally {
        setSaving(false);
      }
    });

  return (
    <>
      <Modal
        open
        title="Add working hours"
        showClose
        onClose={saving ? undefined : onClose}
        dirty={dirty}
        widthClass="max-w-2xl"
        footer={
          <>
            <button type="button" className="btn-secondary bg-transparent" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" form="working-hours-form" className="inline-flex items-center justify-center rounded-lg bg-green-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700/40 disabled:cursor-not-allowed disabled:opacity-60" disabled={locked || !anyWorking} aria-busy={saving || undefined}>
              {saving ? 'Saving…' : 'Save & publish'}
            </button>
          </>
        }
      >
        <form id="working-hours-form" onSubmit={askToSave} className="space-y-5" noValidate>
          <ErrorBanner message={load.error} />
          <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />
          {conflict ? (
            <div className="space-y-3" role="alert" data-testid="schedule-conflict">
              <StatusBanner variant="warning" message={conflict.message} />
              <button type="button" className="btn-primary" onClick={reload}>Reload latest schedule</button>
            </div>
          ) : null}

          <div>
            <label className="label" htmlFor="applies-to">Applies to</label>
            <select id="applies-to" className="input select-chevron bg-transparent" value={target} disabled={saving || scopes.length < 2} onChange={(e) => changeTarget(e.target.value)}>
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {!isCampus && load.usesCampus && !load.loading ? <p className="mt-1 text-xs text-slate-500">{officeName} follows the campus schedule now. This starts from the campus hours; saving gives it a schedule of its own.</p> : null}
          </div>

          {load.loading ? (
            <p className="text-sm text-slate-500" role="status">Loading the schedule…</p>
          ) : (
            <>
              <div>
                <p id="working-days-label" className="label">Working days</p>
                <div role="group" aria-labelledby="working-days-label" className="flex flex-wrap gap-2">
                  {PILL_DAYS.map(({ dow, label }) => {
                    const on = rows.find((r) => r.day_of_week === dow)?.is_working === true;
                    return (
                      <button
                        key={dow}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${DAY_NAMES[dow]}: ${on ? 'working day' : 'non-working day'}`}
                        disabled={locked}
                        onClick={() => edit(togglePill(rows, dow))}
                        className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${on ? 'border-green-600 bg-green-500/10 text-green-700' : 'border-slate-300 bg-transparent text-slate-600 hover:border-slate-400'}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <FieldError id="working-days-error">{errors.days}</FieldError>
              </div>

              {!custom ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TimeField id="shift-start" label="Shift start" value={shift.opening_time} disabled={locked || !anyWorking} onChange={(v) => edit(setShift(rows, { opening_time: v }))} error={sharedError(errors, rows, 'opening_time')} />
                    <TimeField id="shift-end" label="Shift end" value={shift.closing_time} disabled={locked || !anyWorking} onChange={(v) => edit(setShift(rows, { closing_time: v }))} error={sharedError(errors, rows, 'closing_time')} />
                  </div>
                  {!isCampus ? (
                    <div className="space-y-3">
                      <button type="button" role="switch" aria-checked={lunch.on} aria-label="Closes for lunch" disabled={locked || !anyWorking} onClick={() => edit(toggleSharedLunch(rows))} className="flex items-center gap-3 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                        <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${lunch.on ? 'bg-green-700' : 'bg-slate-300'}`}>
                          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${lunch.on ? 'translate-x-5' : ''}`} />
                        </span>
                        Closes for lunch
                      </button>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <TimeField id="lunch-start" label="Lunch start" value={lunch.start} disabled={locked || !lunch.on} onChange={(v) => edit(setLunch(rows, { lunch_start: v }))} error={sharedError(errors, rows, 'lunch_start')} />
                        <TimeField id="lunch-end" label="Lunch end" value={lunch.end} disabled={locked || !lunch.on} onChange={(v) => edit(setLunch(rows, { lunch_end: v }))} error={sharedError(errors, rows, 'lunch_end')} />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <ul className="divide-y divide-[#EAE3D9] rounded-lg border border-slate-200 px-4" data-testid="schedule-editor">
                  {inWeekOrder(rows).filter((r) => r.is_working).map((row) => (
                    <ScheduleDayRow key={row.day_of_week} row={row} errors={errors} disabled={locked} showLunch={!isCampus} onChange={changeRow} />
                  ))}
                </ul>
              )}

              {anyWorking ? (
                <p className="text-sm">
                  <button type="button" className="font-semibold text-green-700 underline" onClick={() => setCustom(!custom)}>
                    {custom ? 'Use the same hours for every working day' : 'Set different hours for specific days'}
                  </button>
                </p>
              ) : null}
            </>
          )}

          <div role="note" className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            <p>{SAVE_NOTE}</p>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="Save and publish working hours?"
        message={`This creates a new record for ${isCampus ? 'the campus' : officeName} and publishes it. Results already computed are not affected; only computations made afterwards follow the new schedule. Times are in Asia/Manila.`}
        confirmLabel="Save & publish"
        confirmClassName="btn-save"
        busy={saving}
        busyLabel="Saving…"
        onConfirm={confirmSave}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
