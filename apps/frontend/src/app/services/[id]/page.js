'use client';

import SubmitButton from '../../../components/ui/SubmitButton.js';
import { notify } from '../../../lib/ui/notify.js';
import { saveFailureMessage, savedMessage } from '../../../lib/ui/save-feedback.js';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../../components/layout/AppShell.js';
import ConfirmDialog from '../../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../../components/feedback/ErrorBanner.js';
import Modal from '../../../components/modals/Modal.js';
import RowActionMenu from '../../../components/ui/RowActionMenu.js';
import StatusBadge from '../../../components/ui/StatusBadge.js';
import DateHint from '../../../components/forms/DateHint.js';
import ServiceForm, { formToBody, serviceToForm } from '../../../components/forms/ServiceForm.js';
import { FieldError, FieldWarning, RequiredMark } from '../../../components/forms/Field.js';
import { formatDate } from '../../../lib/ui/date-format.js';
import { CATALOGUE_API, classificationLabel, scopeLabel, standardText, standardWarning, transactionTypesText } from '../../../lib/api/catalogue.js';
import { apiFetch } from '../../../lib/auth/session.js';
import { useFormDirty } from '../../../lib/ui/useFormDirty.js';
import { useSingleSubmit } from '../../../lib/ui/useSingleSubmit.js';
import { CHARTER_REFERENCE_MAX, durationErrors, serviceSaveError, standardToBody } from '../../../lib/ui/service-form.js';
import { parseDocumentNotes, parseProcedureSteps, splitLinks } from '../../../lib/ui/parseProcedure.js';

const API = CATALOGUE_API;
const EMPTY_STANDARD = { duration_days: '0', duration_hours: '0', duration_minutes: '0', effective_from: '', charter_reference: '' };
const EMPTY_DOC = { document_name: '', is_mandatory: true, notes: '' };

const NOT_SET = 'Not set';
const DETAIL_CARD = 'card p-6';
const CARD_TITLE = 'font-sans text-xl font-bold text-maroon-900';
const HEADER_CHIP = 'rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white';
const GLANCE_LABEL = 'text-xs font-bold uppercase tracking-wider text-slate-500';
const GLANCE_VALUE = 'mt-1 text-sm text-slate-900';
const GLANCE_EMPTY = 'mt-1 text-sm text-slate-500';

// Text with any http(s) addresses turned into links; everything else stays plain text.
function LinkedText({ text, linkLabel }) {
  return splitLinks(text).map((part, i) =>
    part.href ? (
      <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-maroon-800 underline">
        {linkLabel ?? part.href}
      </a>
    ) : (
      <span key={i}>{linkLabel ? part.text.replace(/[\s\-–·]+$/, ' ') : part.text}</span>
    ),
  );
}

function ServiceDetail({ user, id }) {
  const isAdmin = user.role === ROLES.SUPER_ADMIN;
  const [state, setState] = useState({ loading: true, service: null, standards: [], documents: [], error: null });
  const [offices, setOffices] = useState([]);
  const [editForm, setEditForm] = useState(null);
  const [editErrors, setEditErrors] = useState({});
  const [standard, setStandard] = useState({ ...EMPTY_STANDARD });
  const [standardErrors, setStandardErrors] = useState({});
  const [doc, setDoc] = useState(null); // { document_id?, ...fields }
  const [docErrors, setDocErrors] = useState({});
  const [confirm, setConfirm] = useState(null); // { kind, item }
  const [saving, setSaving] = useState(false);
  const editDirty = useFormDirty(editForm);
  const docDirty = useFormDirty(doc);
  const once = useSingleSubmit();

  const reload = useCallback(async () => {
    try {
      const data = await apiFetch(`${API}/services/${encodeURIComponent(id)}`);
      setState({ loading: false, service: data.service, standards: data.standards ?? [], documents: data.documents ?? [], error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, service: null, error: err.message }));
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!isAdmin) return;
    apiFetch(`${API}/offices`)
      .then((data) => setOffices(data.items ?? []))
      .catch(() => setOffices([]));
  }, [isAdmin]);

  const { service, standards, documents } = state;
  const current = service?.current_standard ?? null;

  // A failed save: the field errors go under their fields and one notification says it failed; the form stays open as it was.
  function failWith(err, setErrors) {
    setErrors(err.details && Object.keys(err.details).length > 0 ? err.details : {});
    notify.error(saveFailureMessage(err, err.message));
  }

  function saveService(event) {
    event.preventDefault();
    return once(async () => {
      setSaving(true);
      setEditErrors({});
      try {
        await apiFetch(`${API}/services/${id}`, { method: 'PUT', body: formToBody(editForm, false) });
        setEditForm(null);
        notify.success(savedMessage('Service', 'updated')); // only after the server confirmed
        await reload();
      } catch (err) {
        const { details, message } = serviceSaveError(err); // the code is never sent on an edit; 403 and server failures get safe messages
        setEditErrors(details);
        notify.error(saveFailureMessage(err, message));
      } finally {
        setSaving(false);
      }
    });
  }

  // Typing in a standard field takes that field's message away (and the group message for the three duration parts).
  function changeStandard(patch, ...names) {
    setStandard({ ...standard, ...patch });
    setStandardErrors((current) => {
      const next = { ...current };
      for (const name of names) delete next[name];
      return next;
    });
  }

  function addStandard(event) {
    event.preventDefault();
    const problems = {
      ...durationErrors(standard),
      ...(standard.effective_from ? {} : { effective_from: 'Enter the date the standard starts.' }),
      // The Charter reference is optional: only a too-long one is a problem.
      ...(standard.charter_reference.trim().length > CHARTER_REFERENCE_MAX ? { charter_reference: `Charter reference must be ${CHARTER_REFERENCE_MAX} characters or fewer.` } : {}),
    };
    if (Object.keys(problems).length > 0) {
      setStandardErrors(problems);
      notify.error(saveFailureMessage({ status: 400, details: problems }));
      return undefined;
    }
    return once(async () => {
      setSaving(true);
      setStandardErrors({});
      try {
        await apiFetch(`${API}/services/${id}/standards`, { method: 'POST', body: standardToBody(standard) });
        setStandard({ ...EMPTY_STANDARD });
        notify.success(savedMessage('Standard version', 'created'));
        await reload();
      } catch (err) {
        // Keep what was typed; the service's errors may be keyed with or without a "standard." prefix.
        const details = Object.fromEntries(Object.entries(err.details ?? {}).map(([key, message]) => [key.replace(/^standard./, ''), message]));
        setStandardErrors(details);
        notify.error(saveFailureMessage(err, err.message));
      } finally {
        setSaving(false);
      }
    });
  }

  function saveDoc(event) {
    event.preventDefault();
    if (doc.document_name.trim() === '') {
      setDocErrors({ document_name: 'Enter the document name.' });
      notify.error(saveFailureMessage({ status: 400, details: { document_name: 'x' } }));
      return undefined;
    }
    return once(async () => {
      setSaving(true);
      setDocErrors({});
      try {
        const body = { document_name: doc.document_name, is_mandatory: doc.is_mandatory, notes: doc.notes.trim() === '' ? null : doc.notes };
        if (doc.document_id) await apiFetch(`${API}/services/${id}/documents/${doc.document_id}`, { method: 'PUT', body });
        else await apiFetch(`${API}/services/${id}/documents`, { method: 'POST', body });
        setDoc(null);
        notify.success(savedMessage('Document', doc.document_id ? 'updated' : 'created'));
        await reload();
      } catch (err) {
        failWith(err, setDocErrors);
      } finally {
        setSaving(false);
      }
    });
  }

  async function runConfirm() {
    setSaving(true);
    try {
      if (confirm.kind === 'document') await apiFetch(`${API}/services/${id}/documents/${confirm.item.document_id}`, { method: 'DELETE' });
      else if (confirm.kind === 'standard') await apiFetch(`${API}/services/${id}/standards/${confirm.item.standard_id}`, { method: 'DELETE' });
      else await apiFetch(`${API}/services/${id}/${confirm.kind}`, { method: 'PATCH' });
      setConfirm(null);
      notify.success(
        confirm.kind === 'document' ? savedMessage('Document', 'deleted') : confirm.kind === 'standard' ? savedMessage('Standard version', 'deleted') : savedMessage('Service', confirm.kind === 'reactivate' ? 'reactivated' : 'deactivated'),
      );
      await reload();
    } catch (err) {
      setConfirm(null);
      notify.error(saveFailureMessage(err, err.message));
    } finally {
      setSaving(false);
    }
  }

  // A version can be removed only while it is still in the future: newer than the one in force.
  const isFuture = (s) => (current ? s.version_no > current.version_no : true);

  if (state.loading) return <p className="text-sm text-slate-500">Loading service…</p>;
  if (!service) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={state.error ?? 'This service could not be found.'} />
      </div>
    );
  }

  const steps = parseProcedureSteps(service.processing_steps);

  const confirmText = {
    deactivate: ['Deactivate service?', 'Deactivate', `${service.service_name} will disappear from the public page and can no longer be used to start transactions. You can reactivate it later.`],
    reactivate: ['Reactivate service?', 'Reactivate', `${service.service_name} will appear again in the catalogue and on the public page.`],
    document: ['Remove document?', 'Remove', confirm?.item ? `${confirm.item.document_name} will be removed from the checklist.` : ''],
    standard: ['Delete standard version?', 'Delete', confirm?.item ? `Version ${confirm.item.version_no} has not started yet and will be deleted.` : ''],
  }[confirm?.kind ?? 'deactivate'];

  return (
    <div className="space-y-6">
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: null }))} />

      <header className="rounded-2xl bg-maroon-950 px-5 py-4 text-white sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-80">
            <p className="text-xs font-bold uppercase tracking-wider text-gold-400">
              {service.office_name} &middot; {service.office_code}
            </p>
            <h2 className="mt-1 break-words font-sans text-xl font-bold leading-tight text-white sm:text-2xl">{service.service_name}</h2>
            <p className="mt-1.5 break-all text-sm text-white/90">
              Service code <span className="font-bold">{service.service_code}</span>
            </p>
          </div>
          <div className="ml-auto flex items-start gap-2">
            <div className="flex flex-col items-end gap-2">
              <StatusBadge variant={service.is_active ? 'active' : 'inactive'}>{service.is_active ? 'Active' : 'Inactive'}</StatusBadge>
              <div className="flex flex-wrap justify-end gap-2">
                <span className={HEADER_CHIP}>{classificationLabel(service.classification)}</span>
                {service.fees ? <span className={HEADER_CHIP}>{service.fees}</span> : null}
                {steps ? (
                  <span className={HEADER_CHIP}>
                    {steps.length} {steps.length === 1 ? 'step' : 'steps'}
                  </span>
                ) : null}
              </div>
            </div>
            {isAdmin ? (
              <RowActionMenu
                vertical
                onDark
                label={`Actions for ${service.service_name}`}
                items={[
                  {
                    label: 'Edit',
                    onSelect: () => {
                      setEditErrors({});
                      setEditForm(serviceToForm(service));
                    },
                  },
                  { label: service.is_active ? 'Deactivate' : 'Reactivate', onSelect: () => setConfirm({ kind: service.is_active ? 'deactivate' : 'reactivate' }) },
                ]}
              />
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <section className={DETAIL_CARD} aria-labelledby="procedure-heading">
            <h2 id="procedure-heading" className={CARD_TITLE}>Procedure steps</h2>
            <p className="mt-1 text-sm text-slate-500">Follow the steps in order. Each step shows where to go and who handles it.</p>
            {steps ? (
              <ol className="mt-6 space-y-6">
                {steps.map((step) => (
                  <li key={step.number} className="flex gap-4">
                    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maroon-800 text-sm font-bold text-white">
                      {step.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">
                        <span className="sr-only">Step {step.number}: </span>
                        {step.title}
                        {step.aside ? <span className="ml-1 text-sm font-normal text-slate-500">{step.aside}</span> : null}
                      </p>
                      {step.location ? (
                        <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-500">
                          <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M10 18s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" />
                            <circle cx="10" cy="8" r="2" />
                          </svg>
                          <span>{step.location}</span>
                        </p>
                      ) : null}
                      {step.instruction ? <p className="mt-1 text-sm text-slate-500">{step.instruction}</p> : null}
                      {step.substeps.length > 0 ? (
                        <ul className="mt-3 space-y-2">
                          {step.substeps.map((sub) => (
                            <li key={sub.label} className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-slate-800">
                              <p>
                                <span className="font-bold text-maroon-800">{sub.label}</span> {sub.text}
                              </p>
                              {sub.roles.length > 0 ? (
                                <p className="mt-1.5 flex flex-wrap gap-1.5">
                                  {sub.roles.map((role) => (
                                    <span key={role} className="rounded-full bg-maroon-100 px-2.5 py-0.5 text-xs font-semibold text-maroon-800">
                                      {role}
                                    </span>
                                  ))}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : service.processing_steps ? (
              <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">{service.processing_steps}</p>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No procedure steps recorded. {isAdmin ? 'Use Edit to add them.' : ''}</p>
            )}
          </section>

          <section className={DETAIL_CARD} aria-labelledby="documents-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="documents-heading" className={CARD_TITLE}>Required documents</h2>
                <p className="mt-1 text-sm text-slate-500">What a citizen should bring. Mandatory items are marked.</p>
              </div>
              {isAdmin ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setDocErrors({});
                    setDoc({ ...EMPTY_DOC });
                  }}
                >
                  + Add Document
                </button>
              ) : null}
            </div>
            {documents.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No required documents listed.</p>
            ) : (
              <ul className="mt-5 space-y-3">
                {documents.map((d) => {
                  const parts = parseDocumentNotes(d.notes);
                  return (
                    <li key={d.document_id} className="rounded-xl border border-line p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 basis-60 font-semibold text-slate-900">{d.document_name}</p>
                          {d.is_mandatory ? (
                            <span className="badge-tag shrink-0">Mandatory</span>
                          ) : (
                            <span className="badge-inactive shrink-0">Optional</span>
                          )}
                        </div>
                        {isAdmin ? (
                          <RowActionMenu
                            label={`Actions for ${d.document_name}`}
                            items={[
                              {
                                label: 'Edit',
                                onSelect: () => {
                                  setDocErrors({});
                                  setDoc({ document_id: d.document_id, document_name: d.document_name, is_mandatory: d.is_mandatory, notes: d.notes ?? '' });
                                },
                              },
                              { label: 'Remove', danger: true, onSelect: () => setConfirm({ kind: 'document', item: d }) },
                            ]}
                          />
                        ) : null}
                      </div>
                      {parts ? (
                        <dl className="mt-3 space-y-2 text-sm text-slate-700">
                          {parts.copies ? (
                            <div>
                              <dt className="inline font-bold text-slate-900">Copies: </dt>
                              <dd className="inline">{parts.copies}</dd>
                            </div>
                          ) : null}
                          {parts.where ? (
                            <div>
                              <dt className="inline font-bold text-slate-900">Where to secure: </dt>
                              <dd className="inline">
                                <LinkedText text={parts.where} linkLabel="Open link" />
                              </dd>
                            </div>
                          ) : null}
                          {parts.remarks ? (
                            <div>
                              <dt className="inline font-bold text-slate-900">Remarks: </dt>
                              <dd className="inline">
                                <LinkedText text={parts.remarks} />
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      ) : d.notes ? (
                        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                          <LinkedText text={d.notes} />
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          <section className={DETAIL_CARD} aria-labelledby="glance-heading">
            <h2 id="glance-heading" className={CARD_TITLE}>At a glance</h2>
            <dl className="mt-4 space-y-4">
              <div>
                <dt className={GLANCE_LABEL}>Fees</dt>
                <dd className={service.fees ? 'mt-1 break-words text-2xl font-bold text-maroon-800' : GLANCE_EMPTY}>{service.fees || NOT_SET}</dd>
              </div>
              <div>
                <dt className={GLANCE_LABEL}>Who may avail</dt>
                <dd className={service.who_may_avail ? `${GLANCE_VALUE} whitespace-pre-wrap break-words` : GLANCE_EMPTY}>{service.who_may_avail || NOT_SET}</dd>
              </div>
              <div>
                <dt className={GLANCE_LABEL}>Classification</dt>
                <dd className={GLANCE_VALUE}>{classificationLabel(service.classification)}</dd>
              </div>
              <div>
                <dt className={GLANCE_LABEL}>Measurement</dt>
                <dd className={GLANCE_VALUE}>Timeliness</dd>
              </div>
              <div>
                <dt className={GLANCE_LABEL}>Scope</dt>
                <dd className={service.service_scope ? GLANCE_VALUE : GLANCE_EMPTY}>{service.service_scope ? scopeLabel(service.service_scope) : NOT_SET}</dd>
              </div>
              <div>
                <dt className={GLANCE_LABEL}>Transaction types</dt>
                <dd className={service.transaction_types?.length ? GLANCE_VALUE : GLANCE_EMPTY}>{transactionTypesText(service.transaction_types) || NOT_SET}</dd>
              </div>
            </dl>
          </section>

          <section className={DETAIL_CARD} aria-labelledby="standards-heading">
            <h2 id="standards-heading" className={CARD_TITLE}>Standards</h2>
            <p className="mt-1 text-sm text-slate-500">Each transaction is judged against the version in force on the day it started.</p>
            {standards.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No standard versions yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {standards.map((s) => {
                  const inForce = current && s.standard_id === current.standard_id;
                  return (
                    <li key={s.standard_id} className={`rounded-xl border p-4 ${inForce ? 'border-maroon-100 bg-maroon-50' : 'border-line bg-white'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900">v{s.version_no}</span>
                          {inForce ? (
                            <StatusBadge variant="active">In force</StatusBadge>
                          ) : isFuture(s) ? (
                            <StatusBadge variant="complex">Upcoming</StatusBadge>
                          ) : (
                            <StatusBadge variant="inactive">Superseded</StatusBadge>
                          )}
                        </p>
                        {isAdmin && isFuture(s) ? (
                          <RowActionMenu
                            label={`Actions for version ${s.version_no}`}
                            items={[{ label: 'Delete', danger: true, onSelect: () => setConfirm({ kind: 'standard', item: s }) }]}
                          />
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-800">{standardText(s.duration_days, s.duration_hours, s.duration_minutes)}</p>
                      <FieldWarning>{standardWarning(service.classification, s.duration_days, s.duration_hours, s.duration_minutes)}</FieldWarning>
                      <p className="mt-1 text-sm text-slate-700">
                        {formatDate(s.effective_from) || '-'} &rarr; {s.effective_to ? formatDate(s.effective_to) || '-' : 'Open'}
                      </p>
                      {s.charter_reference ? <p className="mt-1 text-xs text-slate-500">{s.charter_reference}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {isAdmin ? (
              <form onSubmit={addStandard} noValidate className="mt-5 border-t border-slate-200 pt-5">
                <h3 className="font-sans text-base font-bold text-slate-900">Add New Version</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Fields marked <span className="font-bold text-red-700">*</span> are required.
                </p>
                <div className="mt-3 grid gap-4">
                  <div role="group" aria-labelledby="std-duration-label">
                    <p id="std-duration-label" className="label">
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
                          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`std-${name}`}>
                            {label}
                          </label>
                          <input
                            id={`std-${name}`}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            className="input"
                            value={standard[name]}
                            onChange={(e) => changeStandard({ [name]: e.target.value }, name, 'duration')}
                            aria-required="true"
                            aria-invalid={standardErrors[name] || standardErrors.duration ? true : undefined}
                            aria-describedby={standardErrors[name] ? `std-${name}-error` : standardErrors.duration ? 'std-duration-error' : undefined}
                          />
                          <FieldError id={`std-${name}-error`}>{standardErrors[name]}</FieldError>
                        </div>
                      ))}
                    </div>
                    <FieldError id="std-duration-error">{standardErrors.duration}</FieldError>
                  </div>
                  <FieldWarning>{standardWarning(service.classification, standard.duration_days, standard.duration_hours, standard.duration_minutes)}</FieldWarning>
                  <div>
                    <label className="label" htmlFor="std-from">
                      Effective from
                      <RequiredMark />
                    </label>
                    <input
                      id="std-from"
                      type="date"
                      className="input"
                      value={standard.effective_from}
                      onChange={(e) => changeStandard({ effective_from: e.target.value }, 'effective_from')}
                      aria-required="true"
                      aria-invalid={standardErrors.effective_from ? true : undefined}
                      aria-describedby={standardErrors.effective_from ? 'std-from-hint std-from-error' : 'std-from-hint'}
                    />
                    <DateHint id="std-from-hint" />
                    <FieldError id="std-from-error">{standardErrors.effective_from}</FieldError>
                  </div>
                  <div>
                    <label className="label" htmlFor="std-ref">
                      Charter reference
                    </label>
                    <input
                      id="std-ref"
                      className="input"
                      value={standard.charter_reference}
                      onChange={(e) => changeStandard({ charter_reference: e.target.value }, 'charter_reference')}
                      maxLength={200}
                      aria-invalid={standardErrors.charter_reference ? true : undefined}
                      aria-describedby={standardErrors.charter_reference ? 'std-ref-error' : undefined}
                    />
                    <FieldError id="std-ref-error">{standardErrors.charter_reference}</FieldError>
                  </div>
                </div>
                <SubmitButton busy={saving} label="Add version" busyLabel="Creating…" className="btn-primary mt-4" />
              </form>
            ) : null}
          </section>
        </div>
      </div>

      <Modal
        open={editForm !== null}
        title="Edit Service"
        dirty={editDirty}
        widthClass="max-w-2xl"
        onClose={saving ? undefined : () => setEditForm(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditForm(null)} disabled={saving}>
              Cancel
            </button>
            <SubmitButton form="edit-service-form" busy={saving} label="Save" busyLabel="Updating…" />
          </>
        }
      >
        {editForm ? (
          <div className="space-y-4">
            <ServiceForm id="edit-service-form" form={editForm} setForm={setEditForm} errors={editErrors} offices={offices} isNew={false} onSubmit={saveService} currentStandard={current} />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={doc !== null}
        title={doc?.document_id ? 'Edit Document' : 'Add Document'}
        dirty={docDirty}
        onClose={saving ? undefined : () => setDoc(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDoc(null)} disabled={saving}>
              Cancel
            </button>
            <SubmitButton form="doc-form" busy={saving} label="Save" busyLabel={doc?.document_id ? 'Updating…' : 'Creating…'} />
          </>
        }
      >
        {doc ? (
          <form id="doc-form" onSubmit={saveDoc} noValidate className="space-y-4">
            <div>
              <label className="label" htmlFor="doc-name">
                Document name
                <RequiredMark />
              </label>
              <input id="doc-name" className="input" value={doc.document_name} onChange={(e) => setDoc({ ...doc, document_name: e.target.value })} maxLength={200} autoFocus aria-required="true" aria-invalid={docErrors.document_name ? true : undefined} aria-describedby={docErrors.document_name ? 'doc-name-error' : undefined} />
              <FieldError id="doc-name-error">{docErrors.document_name}</FieldError>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={doc.is_mandatory} onChange={(e) => setDoc({ ...doc, is_mandatory: e.target.checked })} />
              Mandatory
            </label>
            <div>
              <label className="label" htmlFor="doc-notes">
                Notes (optional, plain text)
              </label>
              <textarea id="doc-notes" className="input" rows={3} value={doc.notes} onChange={(e) => setDoc({ ...doc, notes: e.target.value })} maxLength={1000} />
              <FieldError id="doc-notes-error">{docErrors.notes}</FieldError>
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={confirmText[0]}
        message={confirmText[2]}
        confirmLabel={confirmText[1]}
        danger={confirm ? confirm.kind !== 'reactivate' : false}
        busy={saving}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

export default function ServiceDetailPage() {
  const { id } = useParams();
  return (
    <AppShell
      title="Service Details"
      eyebrow={
        <Link href="/services" className="inline-flex items-center gap-1.5 rounded text-sm font-semibold text-maroon-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 4-6 6 6 6" />
      </svg>
      Back to services
    </Link>
      }
      subtitle="Standard, required documents and procedure steps.">
      {(user) => <ServiceDetail user={user} id={id} />}
    </AppShell>
  );
}
