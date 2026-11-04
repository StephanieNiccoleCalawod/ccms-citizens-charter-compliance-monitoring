'use client';

import RecordOption from './RecordOption.js';
import { isSelectable } from '../../lib/ui/record-status.js';
import { useEffect, useRef, useState } from 'react';
import { CATALOGUE_API, CLASSIFICATIONS, SERVICE_SCOPES, TRANSACTION_TYPES, standardWarning } from '../../lib/api/catalogue.js';
import { apiFetch } from '../../lib/auth/session.js';
import { PROCEDURE_LIMIT, canUseStepEditor, toStepMode, toTextMode } from '../../lib/ui/procedure-steps.js';
import {
  SERVICE_FORM_FIELDS,
  WHO_MAY_AVAIL_MAX,
  abbreviationProblem,
  charsLeft,
  mapServiceErrors,
  previewErrorMessage,
  previewPlan,
  suggestAbbreviation,
  validateServiceForm,
} from '../../lib/ui/service-form.js';
import DateHint from './DateHint.js';
import { FieldError, FieldWarning, RequiredMark } from './Field.js';
import ProcedureStepsEditor from './ProcedureStepsEditor.js';

export { EMPTY_SERVICE_FORM, formToBody, serviceToForm } from '../../lib/ui/service-form.js';

const FIELD_FOCUS_ORDER = ['office_id', 'service_abbr', 'service_name', 'classification', 'service_scope', 'transaction_types', 'fees', 'who_may_avail', 'processing_steps', 'duration_days', 'duration_hours', 'duration_minutes', 'effective_from', 'charter_reference'];

/**
 * Asks Core which code the next new service of this office and abbreviation would get (GET /services/next-code). It only asks when
 * there is an office and a valid abbreviation (see previewPlan), after a short pause, and an answer that arrives for an office or
 * abbreviation that is no longer the current one is thrown away. The code shown is exactly what Core returned; if Core cannot answer
 * there is a message and no code. States: no_office | invalid | loading | ready | error. `refresh` asks again (after a clash on save).
 */
function useCodePreview(enabled, officeId, abbreviation, refresh) {
  const plan = enabled ? previewPlan(officeId, abbreviation) : null;
  const key = plan?.state === 'ready' ? plan.path : '';
  const [result, setResult] = useState({ key: '', code: null, message: null });
  useEffect(() => {
    if (!key) return undefined;
    let current = true; // false as soon as the office or abbreviation changes, so a late answer is ignored
    const timer = setTimeout(() => {
      apiFetch(`${CATALOGUE_API}${key}`)
        .then((data) => current && setResult({ key, code: typeof data?.service_code === 'string' ? data.service_code : null, message: null }))
        .catch((err) => current && setResult({ key, code: null, message: previewErrorMessage(err) })); // a message, never a made-up code
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, refresh]);
  if (!plan) return { state: 'off' };
  if (plan.state !== 'ready') return plan;
  if (result.key !== key) return { state: 'loading' };
  if (result.code) return { state: 'ready', code: result.code };
  return { state: 'error', message: result.message ?? previewErrorMessage(null) };
}

/**
 * Add / edit service fields. The abbreviation and first standard only appear when adding.
 * `errors` are the service's field errors from the last save; the form adds its own checks before anything is sent.
 * `currentStandard` (edit only) lets the form warn when the saved standard is long for a newly chosen service type.
 */
export default function ServiceForm({ id, form, setForm, errors, offices, isNew, onSubmit, currentStandard = null }) {
  const [clientErrors, setClientErrors] = useState({});
  const [dismissed, setDismissed] = useState({ source: errors, names: [] });
  const formRef = useRef(null);

  const apiErrors = mapServiceErrors(errors, SERVICE_FORM_FIELDS, { isNew });
  const hiddenNames = dismissed.source === errors ? dismissed.names : [];
  const fieldError = (name) => clientErrors[name] ?? (hiddenNames.includes(name) ? undefined : apiErrors.fields[name]);
  const otherMessages = hiddenNames.length ? [] : apiErrors.other;

  const stepMode = form.procedure_mode === 'steps';
  const clear = (...names) => {
    setClientErrors((current) => {
      if (!names.some((n) => n in current)) return current;
      const next = { ...current };
      for (const n of names) delete next[n];
      return next;
    });
    setDismissed({ source: errors, names: [...new Set([...hiddenNames, ...names])] });
  };
  const change = (patch, ...cleared) => {
    clear(...cleared);
    setForm({ ...form, ...patch });
  };
  const set = (name) => (e) => change({ [name]: e.target.value }, name);
  const changeProcedure = (patch) => change(patch, 'processing_steps');

  function toggleType(value) {
    const next = form.transaction_types.includes(value) ? form.transaction_types.filter((t) => t !== value) : [...form.transaction_types, value];
    // keep the order of the list, not the order of clicking
    change({ transaction_types: TRANSACTION_TYPES.map((t) => t.value).filter((t) => next.includes(t)) }, 'transaction_types');
  }

  function submit(event) {
    const problems = validateServiceForm(form, isNew);
    if (Object.keys(problems).length > 0) {
      event.preventDefault();
      setClientErrors(problems);
      const first = FIELD_FOCUS_ORDER.find((name) => problems[name]);
      const target = first && formRef.current?.querySelector(`[data-field="${first}"]`);
      target?.focus();
      return;
    }
    setClientErrors({});
    onSubmit(event);
  }

  // After Core refuses a save because the code was taken meanwhile, ask for a fresh preview.
  const preview = useCodePreview(isNew, form.office_id, form.service_abbr, apiErrors.fields.service_abbr ? errors : null);
  const suggested = isNew && form.service_abbr !== '' && !form.abbr_edited;
  const abbrProblem = isNew && form.service_abbr !== '' ? abbreviationProblem(form.service_abbr) : null;
  const abbrError = fieldError('service_abbr') ?? abbrProblem;
  const warning = isNew
    ? standardWarning(form.classification, form.duration_days, form.duration_hours, form.duration_minutes)
    : currentStandard
      ? standardWarning(form.classification, currentStandard.duration_days, currentStandard.duration_hours, currentStandard.duration_minutes)
      : null;

  const describe = (name) => (fieldError(name) ? `${id}-${name}-error` : undefined);
  const invalid = (name) => (fieldError(name) ? true : undefined);
  const legendClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500';

  return (
    <form id={id} ref={formRef} onSubmit={submit} noValidate className="space-y-5">
      <p className="text-xs text-slate-500">
        Fields marked <span className="font-bold text-red-700">*</span> are required.
      </p>
      {otherMessages.length > 0 ? (
        <ul role="alert" className="list-disc space-y-1 rounded-md border border-red-200 bg-red-50 py-2 pl-7 pr-3 text-sm text-red-800">
          {otherMessages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      <div>
        <label className="label" htmlFor={`${id}-office_id`}>
          Office
          <RequiredMark />
        </label>
        <select
          id={`${id}-office_id`}
          data-field="office_id"
          className="input"
          value={form.office_id}
          onChange={set('office_id')}
          aria-required="true"
          aria-invalid={invalid('office_id')}
          aria-describedby={describe('office_id')}
        >
          <option value="">Select an office</option>
          {offices.filter((o) => isSelectable(o) || o.office_id === form.office_id).map((o) => (
            <RecordOption key={o.office_id} record={o} value={o.office_id}>{o.office_name}</RecordOption>
          ))}
        </select>
        <FieldError id={`${id}-office_id-error`}>{fieldError('office_id')}</FieldError>
      </div>

      <div>
        <label className="label" htmlFor={`${id}-service_name`}>
          Service name
          <RequiredMark />
        </label>
        <input
          id={`${id}-service_name`}
          data-field="service_name"
          className="input"
          value={form.service_name}
          onChange={(e) => {
            const value = e.target.value;
            // Until the person types an abbreviation, the name suggests one (initials of the words).
            if (isNew && !form.abbr_edited) change({ service_name: value, service_abbr: suggestAbbreviation(value) }, 'service_name', 'service_abbr');
            else change({ service_name: value }, 'service_name');
          }}
          maxLength={200}
          aria-required="true"
          aria-invalid={invalid('service_name')}
          aria-describedby={describe('service_name')}
        />
        <FieldError id={`${id}-service_name-error`}>{fieldError('service_name')}</FieldError>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {isNew ? (
          <div>
            <label className="label" htmlFor={`${id}-service_abbr`}>
              Service abbreviation
              <RequiredMark />
              {suggested ? (
                <span className="ml-2 rounded bg-gold-400/30 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-maroon-800" data-testid="abbr-suggested">
                  Suggested
                </span>
              ) : null}
            </label>
            <input
              id={`${id}-service_abbr`}
              data-field="service_abbr"
              className="input uppercase"
              placeholder="e.g. TOR"
              value={form.service_abbr}
              onChange={(e) => {
                // Typing takes over from the suggestion; emptying the box hands it back to the name.
                const value = e.target.value.toUpperCase();
                change({ service_abbr: value, abbr_edited: value.trim() !== '' }, 'service_abbr');
              }}
              maxLength={12}
              autoComplete="off"
              spellCheck={false}
              aria-required="true"
              aria-invalid={abbrError ? true : undefined}
              aria-describedby={[`${id}-service_abbr-hint`, abbrError ? `${id}-service_abbr-error` : null].filter(Boolean).join(' ')}
            />
            <p id={`${id}-service_abbr-hint`} className="mt-1 text-xs text-slate-500">
              {suggested ? 'Suggested from the service name. You can change it.' : '2 to 5 letters or digits. The system adds the office and the number.'}
            </p>
            <FieldError id={`${id}-service_abbr-error`}>{abbrError}</FieldError>
          </div>
        ) : null}
        <div className={isNew ? '' : 'sm:col-span-2'}>
          <p className="label" id={`${id}-service_code-label`}>
            {isNew ? 'Generated service code' : 'Service code'}
          </p>
          <p
            className={`input-readonly break-all ${isNew && preview.state === 'error' ? 'border-red-300 text-red-700' : ''}`.trim()}
            aria-labelledby={`${id}-service_code-label`}
            aria-live="polite"
            aria-busy={preview.state === 'loading' ? true : undefined}
            data-testid="service-code"
            data-state={isNew ? preview.state : 'saved'}
          >
            {isNew
              ? preview.state === 'ready'
                ? preview.code
                : preview.state === 'loading'
                  ? 'Checking the next code…'
                  : preview.message
              : form.service_code || '-'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {isNew
              ? preview.state === 'ready'
                ? 'Preview from the system. The final number is assigned when you save.'
                : 'Read-only. The system builds it from the office and the abbreviation when you save; it cannot be changed afterwards.'
              : 'Read-only. The code stays the same, even if the service is renamed or moves to another office.'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${id}-classification`}>
            Service type
            <RequiredMark />
          </label>
          <select
            id={`${id}-classification`}
            data-field="classification"
            className="input"
            value={form.classification}
            onChange={set('classification')}
            aria-required="true"
            aria-invalid={invalid('classification')}
            aria-describedby={describe('classification')}
          >
            {CLASSIFICATIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <FieldError id={`${id}-classification-error`}>{fieldError('classification')}</FieldError>
        </div>
        <fieldset aria-describedby={describe('service_scope')}>
          <legend className={legendClass}>
            Scope
            <RequiredMark />
          </legend>
          <div className="flex gap-2">
            {SERVICE_SCOPES.map((scope, index) => (
              <label
                key={scope.value}
                className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${form.service_scope === scope.value ? 'border-maroon-800 bg-maroon-50 font-semibold text-maroon-900' : fieldError('service_scope') ? 'border-red-600 text-slate-700' : 'border-slate-300 text-slate-700'}`}
              >
                <input
                  type="radio"
                  name={`${id}-service_scope`}
                  data-field={index === 0 ? 'service_scope' : undefined}
                  className="accent-[#800000]"
                  value={scope.value}
                  checked={form.service_scope === scope.value}
                  onChange={set('service_scope')}
                />
                {scope.label}
              </label>
            ))}
          </div>
          <FieldError id={`${id}-service_scope-error`}>{fieldError('service_scope')}</FieldError>
        </fieldset>
      </div>

      <fieldset aria-describedby={describe('transaction_types')}>
        <legend className={legendClass}>
          Transaction types
          <RequiredMark />
        </legend>
        <div className={`grid gap-2 rounded-md sm:grid-cols-3 ${fieldError('transaction_types') ? 'border border-red-600 p-2' : ''}`}>
          {TRANSACTION_TYPES.map((t, index) => {
            const checked = form.transaction_types.includes(t.value);
            return (
              <label
                key={t.value}
                className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${checked ? 'border-maroon-800 bg-maroon-50 font-semibold text-maroon-900' : 'border-slate-300 text-slate-700'}`}
              >
                <input
                  type="checkbox"
                  data-field={index === 0 ? 'transaction_types' : undefined}
                  className="mt-0.5 accent-[#800000]"
                  checked={checked}
                  onChange={() => toggleType(t.value)}
                />
                <span>{t.label}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-slate-500">Choose every type of transaction this service handles.</p>
        <FieldError id={`${id}-transaction_types-error`}>{fieldError('transaction_types')}</FieldError>
      </fieldset>

      <div>
        <label className="label" htmlFor={`${id}-fees`}>
          Fees (as published in the Charter)
        </label>
        <input
          id={`${id}-fees`}
          data-field="fees"
          className="input"
          value={form.fees}
          onChange={set('fees')}
          maxLength={500}
          aria-invalid={invalid('fees')}
          aria-describedby={describe('fees')}
        />
        <FieldError id={`${id}-fees-error`}>{fieldError('fees')}</FieldError>
      </div>

      <div>
        <div className="flex items-end justify-between gap-2">
          <label className="label mb-0" htmlFor={`${id}-who_may_avail`}>
            Who may avail
          </label>
          <span className={`text-xs ${charsLeft(form.who_may_avail, WHO_MAY_AVAIL_MAX) < 0 ? 'font-semibold text-red-700' : 'text-slate-500'}`} aria-live="polite">
            {form.who_may_avail.length.toLocaleString('en-US')} / {WHO_MAY_AVAIL_MAX.toLocaleString('en-US')}
          </span>
        </div>
        <textarea
          id={`${id}-who_may_avail`}
          data-field="who_may_avail"
          className="input mt-1 min-h-28 whitespace-pre-wrap"
          rows={5}
          value={form.who_may_avail}
          onChange={set('who_may_avail')}
          maxLength={WHO_MAY_AVAIL_MAX}
          aria-invalid={invalid('who_may_avail')}
          aria-describedby={describe('who_may_avail')}
        />
        <FieldError id={`${id}-who_may_avail-error`}>{fieldError('who_may_avail')}</FieldError>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="label mb-0" htmlFor={stepMode ? `${id}-step-1` : `${id}-steps`} id={`${id}-steps-label`}>
            Procedure steps (reference only, plain text)
          </label>
          {stepMode ? (
            <button type="button" className="btn-link" onClick={() => changeProcedure(toTextMode(form))}>
              Edit as text
            </button>
          ) : (
            <button
              type="button"
              className="btn-link"
              disabled={!canUseStepEditor(form.processing_steps)}
              onClick={() => {
                changeProcedure(toStepMode(form));
              }}
            >
              Use step editor
            </button>
          )}
        </div>
        {stepMode ? (
          <div className="mt-2">
            <ProcedureStepsEditor id={id} steps={form.procedure_steps} onChange={(steps) => changeProcedure({ procedure_steps: steps })} describedBy={fieldError('processing_steps') ? `${id}-processing_steps-error` : undefined} />
          </div>
        ) : (
          <>
            <textarea
              id={`${id}-steps`}
              data-field="processing_steps"
              className="input mt-2"
              rows={5}
              value={form.processing_steps}
              onChange={(e) => changeProcedure({ processing_steps: e.target.value })}
              maxLength={PROCEDURE_LIMIT}
              aria-invalid={invalid('processing_steps')}
              aria-describedby={fieldError('processing_steps') ? `${id}-processing_steps-error` : canUseStepEditor(form.processing_steps) ? undefined : `${id}-steps-hint`}
            />
            {!canUseStepEditor(form.processing_steps) ? (
              <p id={`${id}-steps-hint`} className="mt-1 text-xs text-slate-500">
                This text has sub-steps, locations, responsible persons or other formatting the step editor cannot keep exactly, so it stays as text.
              </p>
            ) : null}
          </>
        )}
        <FieldError id={`${id}-processing_steps-error`}>{fieldError('processing_steps')}</FieldError>
      </div>

      {isNew ? (
        <fieldset className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <legend className="px-2 text-sm font-semibold text-maroon-800">First processing standard</legend>
          <div role="group" aria-labelledby={`${id}-duration-label`} aria-describedby={describe('duration')}>
            <p id={`${id}-duration-label`} className={legendClass}>
              Processing standard
              <RequiredMark />
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                ['duration_days', 'Working days'],
                ['duration_hours', 'Hours'],
                ['duration_minutes', 'Minutes'],
              ].map(([name, label]) => (
                <div key={name}>
                  <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${id}-${name}`}>
                    {label}
                  </label>
                  <input
                    id={`${id}-${name}`}
                    data-field={name}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    className="input"
                    value={form[name]}
                    onChange={(e) => change({ [name]: e.target.value }, name, 'duration')}
                    aria-required="true"
                    aria-invalid={invalid(name) ?? invalid('duration')}
                    aria-describedby={fieldError(name) ? `${id}-${name}-error` : describe('duration')}
                  />
                  <FieldError id={`${id}-${name}-error`}>{fieldError(name)}</FieldError>
                </div>
              ))}
            </div>
            <FieldError id={`${id}-duration-error`}>{fieldError('duration')}</FieldError>
            <p className="mt-1 text-xs text-slate-500">Each part is separate: for example 2 working days, 4 hours and 30 minutes.</p>
          </div>
          <FieldWarning>{warning}</FieldWarning>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`${id}-effective_from`}>
                Effective from
                <RequiredMark />
              </label>
              <input
                id={`${id}-effective_from`}
                data-field="effective_from"
                type="date"
                className="input"
                value={form.effective_from}
                onChange={set('effective_from')}
                aria-required="true"
                aria-invalid={invalid('effective_from')}
                aria-describedby={[`${id}-ef-hint`, describe('effective_from')].filter(Boolean).join(' ')}
              />
              <DateHint id={`${id}-ef-hint`} />
              <FieldError id={`${id}-effective_from-error`}>{fieldError('effective_from')}</FieldError>
            </div>
            <div>
              <label className="label" htmlFor={`${id}-charter_reference`}>
                Charter reference
              </label>
              <input
                id={`${id}-charter_reference`}
                data-field="charter_reference"
                className="input"
                value={form.charter_reference}
                onChange={set('charter_reference')}
                maxLength={200}
                aria-invalid={invalid('charter_reference')}
                aria-describedby={describe('charter_reference')}
              />
              <FieldError id={`${id}-charter_reference-error`}>{fieldError('charter_reference')}</FieldError>
            </div>
          </div>
        </fieldset>
      ) : (
        <FieldWarning>{warning}</FieldWarning>
      )}
    </form>
  );
}
