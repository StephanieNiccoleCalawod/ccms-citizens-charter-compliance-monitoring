'use client';

import RecordOption from '../../components/forms/RecordOption.js';
import SubmitButton from '../../components/ui/SubmitButton.js';
import { notify } from '../../lib/ui/notify.js';
import { saveFailureMessage, savedMessage } from '../../lib/ui/save-feedback.js';
import SearchInput from '../../components/forms/SearchInput.js';
import ClearFiltersButton from '../../components/forms/ClearFiltersButton.js';
import { RequiredMark } from '../../components/forms/Field.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppliesToSetting from '../../components/calendar/AppliesToSetting.js';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import DateHint from '../../components/forms/DateHint.js';
import Modal from '../../components/modals/Modal.js';
import { formatDate, formatTime } from '../../lib/ui/date-format.js';
import { CATALOGUE_SETTINGS_API, OFFICES_API } from '../../lib/api/catalogue.js';
import { apiFetch } from '../../lib/auth/session.js';
import { suspensionTimes, timeInputValue, unmatchedErrorMessages } from '../../lib/ui/time-input.js';
import { useFormDirty } from '../../lib/ui/useFormDirty.js';
import StatusBanner from '../../components/feedback/StatusBanner.js';
import { FieldError } from '../../components/forms/Field.js';
import {
  REASON_CATEGORIES,
  REASON_NOT_STORED_NOTICE,
  REFERENCE_MAX,
  hasReason,
  reasonBody,
  reasonDisplay,
  reasonFormFrom,
  reasonProblems,
  reasonStored,
  referenceCounter,
  referenceError,
} from '../../lib/ui/suspension-reason.js';
import {
  APPLIES_TO,
  CLASS_MODES,
  DAY_NAMES,
  EXCEPTION_TYPES,
  MONTH_NAMES,
  NAGER_REFERENCE,
  TYPE_CATEGORIES,
  appliesToBody,
  appliesToErrors,
  classModeFor,
  dateString,
  daysInMonth,
  describeEffect,
  firstWeekday,
  formAppliesTo,
  matchesAppliesTo,
  occurrenceInMonth,
  shiftMonth,
  todayManila,
  typeCategory,
  typeLabel,
} from '../../lib/api/calendar.js';

const EXCEPTIONS_API = '/api/calendar/exceptions';
const NAGER_API = '/api/calendar/holidays/nager';
const EMPTY_FORM = { exception_date: '', exception_type: 'REGULAR_HOLIDAY', description: '', office_id: '', suspended_from: '', suspended_until: '', is_recurring: false, applies_to: 'BOTH', class_mode: 'SUSPENDED', reason_category: '', reference: '' };

export default function Holidays({ canWrite = false, onChanged }) {
  const today = todayManila();
  const [month, setMonth] = useState({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [nager, setNager] = useState(null);
  const [offices, setOffices] = useState({ items: [], error: null });
  const [form, setForm] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ search: '', type: '', applies_to: '' });
  // applies_to_enabled, from Core (every role can read it). Until it is known, and while it is off, the new controls do not appear.
  const [setting, setSetting] = useState({ loading: true, enabled: false, error: null });
  const enabled = setting.enabled === true;
  const formDirty = useFormDirty(form);
  // CC058: set when a save came back without the reason fields, i.e. the calendar service did not keep them (see lib/ui/suspension-reason.js).
  const [reasonNotice, setReasonNotice] = useState(false);

  const from = dateString(month.year, month.month, 1);
  const to = dateString(month.year, month.month, daysInMonth(month.year, month.month));
  const year = month.year;
  const liveHolidays = nager?.year === year ? nager : null;

  const latestLoad = useRef(0); // only the newest answer may update the page
  const appliesFilter = enabled ? filters.applies_to : ''; // the filter only exists while the setting is on
  const load = useCallback(async () => {
    const request = ++latestLoad.current;
    try {
      const data = await apiFetch(`${EXCEPTIONS_API}?from=${from}&to=${to}${appliesFilter ? `&applies_to=${appliesFilter}` : ''}`);
      if (request !== latestLoad.current) return;
      setState({ loading: false, items: data.items, error: null });
    } catch (err) {
      if (request !== latestLoad.current) return;
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [from, to, appliesFilter]);

  const loadSetting = useCallback(async () => {
    setSetting((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await apiFetch(CATALOGUE_SETTINGS_API);
      setSetting({ loading: false, enabled: data?.settings?.applies_to_enabled === true, error: null });
    } catch (err) {
      setSetting({ loading: false, enabled: false, error: err.message });
    }
  }, []);

  useEffect(() => {
    loadSetting();
  }, [loadSetting]);

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    load();
  }, [load]);

  useEffect(() => {
    let current = true;
    apiFetch(`${NAGER_API}?year=${year}`)
      .then((data) => {
        if (data?.year !== year || typeof data.available !== 'boolean' || !Array.isArray(data.items)) {
          throw new Error('Expected live Nager.Date response');
        }
        if (current) setNager(data);
      })
      .catch(() => {
        if (current) setNager({ year, items: [], unavailable: true });
      });
    return () => { current = false; };
  }, [year]);

  useEffect(() => {
    let cancelled = false;
    apiFetch(OFFICES_API)
      .then((data) => {
        if (!cancelled) setOffices({ items: data.items, error: null });
      })
      .catch((err) => {
        if (!cancelled) setOffices({ items: [], error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const officeName = useMemo(() => {
    const map = new Map(offices.items.map((o) => [o.office_id, `${o.office_code} - ${o.office_name}`]));
    return (id) => (id ? (map.get(id) ?? 'Unknown office') : 'Campus-wide');
  }, [offices.items]);

  // Entries placed on the day they fall on in the shown month (recurring ones in the shown year).
  const rows = useMemo(() => {
    const saved = state.items
      .map((entry) => ({ entry, date: occurrenceInMonth(entry, month.year, month.month) }))
      .filter(({ date }) => date);
    const campusDates = new Set(saved.filter(({ entry }) => !entry.office_id).map(({ date }) => date));
    const references = (liveHolidays?.items ?? [])
      .filter(({ date }) => date >= from && date <= to && !campusDates.has(date))
      .map(({ date, name }) => ({
        date,
        entry: { exception_id: `nager-${date}-${name}`, exception_type: NAGER_REFERENCE, description: name, nager: true },
      }));
    return [...saved, ...references].sort((a, b) => a.date.localeCompare(b.date) || a.entry.exception_type.localeCompare(b.entry.exception_type));
  }, [state.items, month, liveHolidays, from, to]);

  // The search and type filters apply to the registry, the day markers and the selected-day card alike.
  const visibleRows = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    return rows.filter(({ entry, date }) => {
      if (filters.type && entry.exception_type !== filters.type) return false;
      if (appliesFilter && (entry.nager || !matchesAppliesTo(entry, appliesFilter))) return false;
      if (!term) return true;
      return [entry.description ?? '', typeLabel(entry.exception_type), date].some((text) => text.toLowerCase().includes(term));
    });
  }, [rows, filters, appliesFilter]);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const row of visibleRows) map.set(row.date, [...(map.get(row.date) ?? []), row.entry]);
    return map;
  }, [visibleRows]);

  function goToMonth(next) {
    setMonth(next);
    setSelected(null);
  }

  function pickDay(date, inMonth) {
    if (!inMonth) setMonth({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });
    setSelected(date);
  }

  // Core's messages for fields this form has no input for (the class fields while the setting is off, or any other name) show in the form's banner.
  const shownFields = ['exception_date', 'exception_type', 'description', 'office_id', 'suspended_from', 'suspended_until', 'is_recurring', ...(hasReason(form?.exception_type) ? ['reason_category', 'reference'] : []), ...(enabled ? ['applies_to', ...(form?.applies_to !== 'WORK' ? ['class_mode'] : [])] : [])];
  const formLevelErrors = unmatchedErrorMessages(fieldErrors, shownFields);

  function openForm(date) {
    setFieldErrors({});
    setForm({ ...EMPTY_FORM, exception_date: date ?? selected ?? from });
  }

  // Edit: the form starts from what Core returned for the entry (its anchor date, every field, applies_to and class_mode as saved).
  function openEdit(entry) {
    setFieldErrors({});
    setForm({
      id: entry.exception_id,
      exception_date: entry.exception_date,
      exception_type: entry.exception_type,
      description: entry.description ?? '',
      office_id: entry.office_id ?? '',
      suspended_from: timeInputValue(entry.suspended_from),
      suspended_until: timeInputValue(entry.suspended_until),
      is_recurring: entry.is_recurring === true,
      ...formAppliesTo(entry),
      ...reasonFormFrom(entry),
    });
  }

  function setType(value) {
    setForm((f) => ({ ...f, exception_type: value, is_recurring: value === 'SUSPENSION' ? false : f.is_recurring }));
  }

  // Offices only has no class mode: it is cleared. Back to offices and classes or classes only it returns to No classes unless one was chosen.
  function setAppliesTo(value) {
    setForm((f) => ({ ...f, applies_to: value, class_mode: classModeFor(value, f.class_mode) }));
    setFieldErrors((errors) => ({ ...errors, applies_to: undefined, class_mode: undefined }));
  }

  async function save(event) {
    event.preventDefault();
    if (!canWrite || saving) return;
    const time = suspensionTimes(form.suspended_from, form.suspended_until);
    const problems = { ...appliesToErrors(enabled, form.applies_to, form.class_mode), ...time.errors, ...reasonProblems(form) };
    if (Object.keys(problems).length) {
      setFieldErrors(problems); // what was typed stays; nothing is sent
      notify.error(saveFailureMessage({ status: 400, details: problems }));
      return;
    }
    setSaving(true);
    setFieldErrors({});
    try {
      const body = {
        exception_date: form.exception_date,
        exception_type: form.exception_type,
        description: form.description.trim(),
        office_id: form.office_id || null,
        suspended_from: time.from, // HH:mm as the API wants it, or null for the whole day
        suspended_until: time.until,
        is_recurring: form.exception_type === 'SUSPENSION' ? false : form.is_recurring,
        ...appliesToBody(enabled, form.applies_to, form.class_mode),
        ...reasonBody(form), // CC058: only for a suspension; extra fields beside the existing ones
      };
      const answer = form.id ? await apiFetch(`${EXCEPTIONS_API}/${form.id}`, { method: 'PUT', body }) : await apiFetch(EXCEPTIONS_API, { method: 'POST', body });
      setReasonNotice(hasReason(body.exception_type) && !reasonStored(answer));
      setForm(null);
      // The saved type decides the word: a suspension is not a holiday. Said only after the server confirmed.
      notify.success(savedMessage(body.exception_type === 'SUSPENSION' ? 'Suspension' : 'Holiday', form.id ? 'updated' : 'created'));
      await load();
      onChanged?.();
    } catch (err) {
      setFieldErrors(err.details ?? {});
      // While the setting is off the two fields are not on the form, so Core's explanation (it refuses them) is the message.
      const refused = !enabled && (err.details?.applies_to || err.details?.class_mode) ? (err.details.applies_to ?? err.details.class_mode) : null;
      notify.error(saveFailureMessage(err, refused ?? err.message)); // the form stays open with what was typed
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!canWrite) return;
    setSaving(true);
    try {
      await apiFetch(`${EXCEPTIONS_API}/${confirm.exception_id}`, { method: 'DELETE' });
      setConfirm(null);
      notify.success(savedMessage(confirm.exception_type === 'SUSPENSION' ? 'Suspension' : 'Holiday', 'deleted'));
      await load();
      onChanged?.();
    } catch (err) {
      setConfirm(null);
      notify.error(saveFailureMessage(err, err.message));
    } finally {
      setSaving(false);
    }
  }

  // Always six weeks (42 cells), Sunday first; days of the neighbouring months are greyed.
  const leading = firstWeekday(month.year, month.month);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const prevDays = daysInMonth(prev.year, prev.month);
  const total = daysInMonth(month.year, month.month);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const offset = i - leading + 1;
    if (offset < 1) return { date: dateString(prev.year, prev.month, prevDays + offset), day: prevDays + offset, inMonth: false };
    if (offset > total) return { date: dateString(next.year, next.month, offset - total), day: offset - total, inMonth: false };
    return { date: dateString(month.year, month.month, offset), day: offset, inMonth: true };
  });
  const selectedEntries = selected ? (byDate.get(selected) ?? []) : [];

  return (
    <div className="space-y-6">
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: null }))} />
      {reasonNotice ? <StatusBanner variant="warning" message={REASON_NOT_STORED_NOTICE} onDismiss={() => setReasonNotice(false)} /> : null}

     

      {canWrite ? <AppliesToSetting settings={setting} onRetry={loadSetting} onSaved={(value) => setSetting({ loading: false, enabled: value, error: null })} /> : null}

      <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-4">
        <div className="w-full sm:w-64">
          <label className="label" htmlFor="holiday-search">
            Search holiday
          </label>
          <SearchInput id="holiday-search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        </div>
        <div className="w-full sm:w-44">
          <label className="label" htmlFor="holiday-type">
            Holiday type
          </label>
          <select id="holiday-type" className="input select-chevron" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
            <option value="">All types</option>
            <option value={NAGER_REFERENCE}>Nager.Date reference</option>
            {EXCEPTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {enabled ? (
          <div className="w-full sm:w-52">
            <label className="label" htmlFor="holiday-applies-to">
              Applies to
            </label>
            <select id="holiday-applies-to" className="input select-chevron" value={filters.applies_to} onChange={(e) => setFilters({ ...filters, applies_to: e.target.value })}>
              <option value="">All</option>
              {APPLIES_TO.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="w-full sm:w-44">
          <label className="label" htmlFor="holiday-month">
            Month
          </label>
          <select id="holiday-month" className="input select-chevron" value={month.month} onChange={(e) => goToMonth({ year: month.year, month: Number(e.target.value) })}>
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {filters.search.trim() || filters.type || appliesFilter ? (
          <ClearFiltersButton className="w-full sm:w-auto" onClick={() => setFilters({ search: '', type: '', applies_to: '' })} />
        ) : null}
        {canWrite ? (
          <div className="ml-auto">
            <button type="button" className="btn-primary bg-maroon-900 px-5 py-2.5" onClick={() => openForm(null)}>
              + Add Holiday
            </button>
          </div>
        ) : null}
      </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <section className="card flex min-h-48 flex-col justify-center p-6" aria-labelledby="day-heading" aria-live="polite">
            {selected ? (
              <div>
                <h3 id="day-heading" className="text-lg font-bold">
                  {formatDate(selected)}
                </h3>
                {selectedEntries.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No holidays on this date.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {selectedEntries.map((entry) => {
                      const category = typeCategory(entry.exception_type);
                      return (
                        <li key={entry.exception_id} className="rounded-lg border border-slate-200 p-3 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-slate-900">{entry.description || typeLabel(entry.exception_type)}</p>
                            <span className={`badge shrink-0 ${category.badge}`}>{category.label}</span>
                          </div>
                          {entry.nager ? (
                            <p className="mt-2 text-xs text-slate-600">{typeLabel(entry.exception_type)} · Nager.Date reference</p>
                          ) : (
                            <>
                              {enabled ? <p className="mt-1 text-xs font-semibold text-maroon-800" data-testid="entry-effect">{describeEffect(entry)}</p> : null}
                              <dl className="mt-2 space-y-0.5 text-xs text-slate-600">
                                <div>Type: {typeLabel(entry.exception_type)}</div>
                                <div>Scope: {officeName(entry.office_id)}</div>
                                <div>Suspended from: {entry.suspended_from ? formatTime(entry.suspended_from) || entry.suspended_from : 'Whole day'}</div>
                                {entry.suspended_until ? <div>Suspended until: {formatTime(entry.suspended_until) || entry.suspended_until}</div> : null}
                                {hasReason(entry.exception_type) ? <div data-testid="entry-reason">Reason: {reasonDisplay(entry).category}</div> : null}
                                {hasReason(entry.exception_type) ? <div data-testid="entry-reference">Reference: {reasonDisplay(entry).reference}</div> : null}
                                <div>Repeats: {entry.is_recurring ? `Every year (from ${entry.exception_date.slice(0, 4)})` : 'No'}</div>
                              </dl>
                            </>
                          )}
                          {canWrite && !entry.nager ? (
                            <div className="mt-2 flex justify-end gap-4">
                              <button type="button" className="btn-link" onClick={() => openEdit(entry)}>
                                Edit
                              </button>
                              <button type="button" className="btn-link" onClick={() => setConfirm(entry)}>
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {canWrite ? (
                  <button type="button" className="btn-link mt-3" onClick={() => openForm(selected)}>
                    + Add on this date
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <svg className="h-10 w-10 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2M14 17h2" strokeLinecap="round" />
                </svg>
                <p id="day-heading" className="text-sm font-medium text-slate-700">
                  Click a date to see its holidays
                </p>
              </div>
            )}
          </section>

          <section className="card p-6" aria-labelledby="registry-heading">
            <h3 id="registry-heading" className="text-lg font-bold">
              Holiday Registry
            </h3>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {visibleRows.length} {visibleRows.length === 1 ? 'holiday' : 'holidays'} shown
              <span className="font-normal">
                {' '}
                · {MONTH_NAMES[month.month - 1]} {month.year}
              </span>
            </p>
            <p role="status" className="mt-2 text-xs text-slate-600">
              {liveHolidays?.unavailable ? 'Nager.Date is temporarily unavailable.' :
                liveHolidays && !liveHolidays.items.length ? 'No Nager.Date holidays are available for this year.' :
                  liveHolidays ? 'Nager.Date references are shown for planning. Saved CCMS entries determine working days.' :
                    'Loading holidays from Nager.Date…'}
            </p>
            {state.loading ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading entries…</p>
            ) : visibleRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-700">No holidays in registry</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {visibleRows.map(({ entry, date }) => {
                  const category = typeCategory(entry.exception_type);
                  return (
                    <li key={`${entry.exception_id}-${date}`} className="flex items-center gap-3 py-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${category.dot}`} aria-hidden="true" />
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => pickDay(date, true)}>
                        <span className="block truncate text-sm font-semibold text-slate-900">{entry.description || typeLabel(entry.exception_type)}</span>
                        <span className="block text-xs text-slate-500">
                          {formatDate(date)} · {typeLabel(entry.exception_type)} · {entry.nager ? 'Nager.Date reference' : officeName(entry.office_id)}
                        </span>
                        {enabled && !entry.nager ? <span className="mt-0.5 block text-xs font-semibold text-maroon-800" data-testid="entry-effect">{describeEffect(entry)}</span> : null}
                        {!entry.nager && hasReason(entry.exception_type) ? (
                          <span className="mt-0.5 block text-xs text-slate-600" data-testid="entry-reason-line">
                            Reason: {reasonDisplay(entry).category} · Ref: {reasonDisplay(entry).reference}
                          </span>
                        ) : null}
                      </button>
                      {canWrite && !entry.nager ? (
                        <div className="flex shrink-0 gap-3">
                          <button type="button" className="btn-link" onClick={() => openEdit(entry)}>
                            Edit
                          </button>
                          <button type="button" className="btn-link" onClick={() => setConfirm(entry)}>
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <section className="card p-4 sm:p-6" aria-label="Month view">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-2xl" aria-live="polite">
              <span className="font-bold">{MONTH_NAMES[month.month - 1]}</span> <span className="font-normal text-slate-500">{month.year}</span>
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                onClick={() => goToMonth(prev)}
                aria-label="Previous month"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                onClick={() => goToMonth(next)}
                aria-label="Next month"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M8 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
          <ul className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
            {TYPE_CATEGORIES.map((c) => (
              <li key={c.id} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${c.dot}`} aria-hidden="true" />
                {c.label}
              </li>
            ))}
          </ul>
          {enabled ? (
            <p className="mt-2 text-xs text-slate-500">
              {APPLIES_TO.map((a) => `${a.short} = ${a.label}`).join(' · ')}
            </p>
          ) : null}

          <div className="mt-4 grid grid-cols-7 border-b border-slate-200 pb-2 text-center text-[11px] font-bold uppercase tracking-wide">
            {DAY_NAMES.map((d, index) => (
              <div key={d} className={index === 0 ? 'text-red-600' : 'text-slate-500'}>
                {d.slice(0, 3)}
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-7 overflow-hidden rounded-xl border border-slate-200">
            {cells.map((cell, index) => {
              const entries = cell.inMonth ? (byDate.get(cell.date) ?? []) : [];
              const categories = TYPE_CATEGORIES.filter((c) => entries.some((e) => typeCategory(e.exception_type).id === c.id));
              const kinds = enabled ? APPLIES_TO.filter((a) => entries.some((e) => !e.nager && (e.applies_to ?? 'BOTH') === a.value)) : [];
              const isSelected = cell.date === selected;
              const tone = isSelected ? 'bg-maroon-50 ring-2 ring-inset ring-maroon-800' : cell.inMonth ? 'bg-white hover:bg-slate-50' : 'bg-slate-50 hover:bg-slate-100';
              const numberTone = !cell.inMonth ? 'text-slate-400' : index % 7 === 0 ? 'text-red-600' : 'text-slate-900';
              return (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => pickDay(cell.date, cell.inMonth)}
                  aria-pressed={isSelected}
                  className={`flex min-h-14 flex-col items-start border-b border-r border-slate-100 p-1.5 text-left text-xs sm:min-h-20 sm:p-2 ${tone}`}
                  aria-label={`${formatDate(cell.date)}${entries.length ? `: ${entries.map((e) => `${e.description || typeLabel(e.exception_type)}${e.nager ? ' (Nager.Date reference)' : enabled ? ` (${describeEffect(e)})` : ''}`).join(', ')}` : ''}`}
                >
                  <span className={`font-semibold ${numberTone} ${cell.date === today ? 'rounded-full bg-gold-400/40 px-1.5' : ''}`}>{cell.day}</span>
                  {categories.length > 0 ? (
                    <span className="mt-1 flex gap-1">
                      {categories.map((c) => (
                        <span key={c.id} className={`h-2 w-2 rounded-full ${c.dot}`} aria-hidden="true" />
                      ))}
                    </span>
                  ) : null}
                  {kinds.length > 0 ? (
                    <span className="mt-1 flex flex-wrap gap-1" data-testid="cell-effect">
                      {kinds.map((a) => (
                        <span key={a.value} title={a.label} className="rounded bg-maroon-50 px-1 text-[9px] font-bold leading-4 text-maroon-800">
                          {a.short}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {entries.length > 0 ? (
                    <span className="mt-1 hidden w-full truncate text-[10px] text-slate-600 sm:block">{entries[0].description || typeLabel(entries[0].exception_type)}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {canWrite ? (
        <>
          <Modal
            open={form !== null}
            title={form?.id ? 'Edit holiday or suspension' : 'Add holiday or suspension'}
            dirty={formDirty}
            onClose={saving ? undefined : () => setForm(null)}
            footer={
              <>
                <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={saving}>
                  Cancel
                </button>
                <SubmitButton form="exception-form" busy={saving} label="Save" busyLabel={form?.id ? 'Updating…' : 'Creating…'} />
              </>
            }
          >
            {form ? (
              <form id="exception-form" onSubmit={save} className="space-y-4">
                <ErrorBanner message={offices.error ? `Offices could not be loaded: ${offices.error}` : null} />
                <ErrorBanner message={formLevelErrors.join(' ') || null} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="exception_date">
                      Date<RequiredMark /></label>
                    <input id="exception_date" type="date" className="input" value={form.exception_date} onChange={(e) => setForm({ ...form, exception_date: e.target.value })} required aria-describedby="exception_date-hint" />
                    <DateHint id="exception_date-hint" />
                    {fieldErrors.exception_date ? <p className="mt-1 text-xs text-red-700">{fieldErrors.exception_date}</p> : null}
                  </div>
                  <div>
                    <label className="label" htmlFor="exception_type">
                      Type
                    </label>
                    <select id="exception_type" className="input" value={form.exception_type} onChange={(e) => setType(e.target.value)} required>
                      <option value="" disabled>Choose holiday type</option>
                      {EXCEPTION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.exception_type ? <p className="mt-1 text-xs text-red-700">{fieldErrors.exception_type}</p> : null}
                  </div>
                </div>
                {hasReason(form.exception_type) ? (
                  <div className="grid gap-4 sm:grid-cols-2" data-testid="reason-fields">
                    <div>
                      <label className="label" htmlFor="reason_category">
                        Reason category<RequiredMark />
                      </label>
                      <select
                        id="reason_category"
                        className="input select-chevron"
                        value={form.reason_category}
                        onChange={(e) => {
                          setForm({ ...form, reason_category: e.target.value });
                          setFieldErrors((errors) => ({ ...errors, reason_category: undefined }));
                        }}
                        aria-required="true"
                        aria-invalid={fieldErrors.reason_category ? 'true' : undefined}
                        aria-describedby="reason_category-error"
                      >
                        <option value="">Select a reason</option>
                        {REASON_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <FieldError id="reason_category-error">{fieldErrors.reason_category}</FieldError>
                    </div>
                    <div>
                      <div className="flex items-baseline justify-between gap-2">
                        <label className="label" htmlFor="reference">
                          Reference / Memorandum number
                        </label>
                        <span className={`text-xs ${referenceError(form.reference) ? 'font-semibold text-red-700' : 'text-slate-500'}`} data-testid="reference-counter" aria-live="polite">
                          {referenceCounter(form.reference)}
                        </span>
                      </div>
                      <input
                        id="reference"
                        className="input"
                        value={form.reference}
                        onChange={(e) => {
                          setForm({ ...form, reference: e.target.value });
                          setFieldErrors((errors) => ({ ...errors, reference: undefined }));
                        }}
                        aria-invalid={fieldErrors.reference ? 'true' : undefined}
                        aria-describedby="reference-help reference-error"
                        autoComplete="off"
                      />
                      <p id="reference-help" className="mt-1 text-xs text-slate-500">Optional. For example the memorandum number. Up to {REFERENCE_MAX} characters.</p>
                      <FieldError id="reference-error">{fieldErrors.reference}</FieldError>
                    </div>
                  </div>
                ) : null}
                <div>
                  <label className="label" htmlFor="description">
                    Description
                  </label>
                  <input id="description" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} />
                  {fieldErrors.description ? <p className="mt-1 text-xs text-red-700">{fieldErrors.description}</p> : null}
                </div>
                <div>
                  <label className="label" htmlFor="office_id">
                    Scope
                  </label>
                  <select id="office_id" className="input" value={form.office_id} onChange={(e) => setForm({ ...form, office_id: e.target.value })}>
                    <option value="">Campus-wide (all offices)</option>
                    {offices.items.map((o) => (
                      <RecordOption key={o.office_id} record={o} value={o.office_id}>{`${o.office_code} - ${o.office_name}`}</RecordOption>
                    ))}
                  </select>
                  {fieldErrors.office_id ? <p className="mt-1 text-xs text-red-700">{fieldErrors.office_id}</p> : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="suspended_from">
                      Suspended from
                    </label>
                    <input
                      id="suspended_from"
                      type="time"
                      className="input"
                      aria-invalid={fieldErrors.suspended_from ? true : undefined}
                      aria-describedby="suspended-times-hint"
                      value={form.suspended_from}
                      onChange={(e) => setForm({ ...form, suspended_from: e.target.value })}
                    />
                    {fieldErrors.suspended_from ? <p className="mt-1 text-xs text-red-700">{fieldErrors.suspended_from}</p> : null}
                  </div>
                  <div>
                    <label className="label" htmlFor="suspended_until">
                      Suspended until
                    </label>
                    <input
                      id="suspended_until"
                      type="time"
                      className="input"
                      aria-invalid={fieldErrors.suspended_until ? true : undefined}
                      aria-describedby="suspended-times-hint"
                      value={form.suspended_until}
                      onChange={(e) => setForm({ ...form, suspended_until: e.target.value })}
                    />
                    {fieldErrors.suspended_until ? <p className="mt-1 text-xs text-red-700">{fieldErrors.suspended_until}</p> : null}
                  </div>
                  <p id="suspended-times-hint" className="text-xs text-slate-500 sm:col-span-2">Leave both empty for a whole-day suspension. For part of the day, enter both times.</p>
                </div>
                {enabled ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="label" htmlFor="applies_to">
                        Applies to
                      </label>
                      <select id="applies_to" className="input select-chevron" value={form.applies_to} onChange={(e) => setAppliesTo(e.target.value)} aria-invalid={fieldErrors.applies_to ? true : undefined} aria-describedby="applies_to-help">
                        {APPLIES_TO.map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                      <p id="applies_to-help" className="mt-1 text-xs text-slate-500">
                        {APPLIES_TO.find((a) => a.value === form.applies_to)?.help}
                      </p>
                      {fieldErrors.applies_to ? <p className="mt-1 text-xs text-red-700">{fieldErrors.applies_to}</p> : null}
                    </div>
                    {form.applies_to !== 'WORK' ? (
                      <div>
                        <label className="label" htmlFor="class_mode">
                          Classes are
                        </label>
                        <select id="class_mode" className="input select-chevron" value={form.class_mode} onChange={(e) => setForm({ ...form, class_mode: e.target.value })} aria-invalid={fieldErrors.class_mode ? true : undefined}>
                          {CLASS_MODES.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.class_mode ? <p className="mt-1 text-xs text-red-700">{fieldErrors.class_mode}</p> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={form.is_recurring} disabled={form.exception_type === 'SUSPENSION'} onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })} />
                    Repeats every year on this date
                  </label>
                  {form.exception_type === 'SUSPENSION' ? <p className="mt-1 text-xs text-slate-500">Suspensions cannot be recurring.</p> : null}
                  {fieldErrors.is_recurring ? <p className="mt-1 text-xs text-red-700">{fieldErrors.is_recurring}</p> : null}
                </div>
              </form>
            ) : null}
          </Modal>

          <ConfirmDialog
            open={confirm !== null}
            title="Delete entry?"
            message={
              confirm
                ? `${typeLabel(confirm.exception_type)} on ${formatDate(confirm.exception_date)}${confirm.description ? ` (${confirm.description})` : ''} will be removed.${
                    confirm.is_recurring ? ' This entry repeats every year: it is removed for every year, not only the one shown.' : ''
                  } Deadlines computed afterwards will use the new calendar.`
                : ''
            }
            confirmLabel="Delete"
            danger
            busy={saving}
            onConfirm={remove}
            onCancel={() => setConfirm(null)}
          />
        </>
      ) : null}
    </div>
  );
}
