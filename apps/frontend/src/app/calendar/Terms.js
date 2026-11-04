'use client';

import { RequiredMark } from '../../components/forms/Field.js';
import { useCallback, useEffect, useState } from 'react';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import DateHint from '../../components/forms/DateHint.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import Modal from '../../components/modals/Modal.js';
import { formatDate } from '../../lib/ui/date-format.js';
import RowActionMenu from '../../components/ui/RowActionMenu.js';
import TableState from '../../components/ui/TableState.js';
import { apiFetch } from '../../lib/auth/session.js';
import { useFormDirty } from '../../lib/ui/useFormDirty.js';

const TERMS_API = '/api/calendar/terms';
const EMPTY = { term_name: '', start_date: '', end_date: '' };

export default function Terms({ canWrite = false, onChanged }) {
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [form, setForm] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const formDirty = useFormDirty(form);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch(TERMS_API);
      setState({ loading: false, items: data.items, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function open(term) {
    setFieldErrors({});
    setFormError(null);
    setForm(term ? { id: term.term_id, term_name: term.term_name, start_date: term.start_date, end_date: term.end_date } : { ...EMPTY });
  }

  async function save(event) {
    event.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const body = { term_name: form.term_name.trim(), start_date: form.start_date, end_date: form.end_date };
      if (form.id) await apiFetch(`${TERMS_API}/${form.id}`, { method: 'PUT', body });
      else await apiFetch(TERMS_API, { method: 'POST', body });
      setForm(null);
      await load();
      onChanged?.();
    } catch (err) {
      setFieldErrors(err.details ?? {});
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: null }))} />
      <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-l-4 border-[#EAE3D9] border-l-gold-500 bg-white px-5 py-4">
        <p className="flex items-start gap-3 text-sm text-slate-800">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-[#7A5C00]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          <span>Academic terms are shared with Audit. They do not change how CCMS computes deadlines.</span>
        </p>
        {canWrite && !state.loading && state.items.length > 0 ? (
          <button type="button" className="btn-primary" onClick={() => open(null)}>
            + Add academic term
          </button>
        ) : null}
      </div>
      <TableShell>
        <Table
          busy={state.loading}
          head={
            <tr>
              <Th>Term</Th>
              <Th>Start date</Th>
              <Th>End date</Th>
              {canWrite ? <Th align="right">Action</Th> : null}
            </tr>
          }
        >
              {state.loading ? (
                <TableState colSpan={canWrite ? 4 : 3} kind="loading">Loading terms…</TableState>
              ) : state.items.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 4 : 3} className="px-6 py-14 text-center">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="mx-auto h-9 w-9 text-stone-400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="5" width="18" height="16" rx="2" />
                      <path d="M3 10h18M8 3v4M16 3v4" />
                    </svg>
                    <p className="mt-3 font-bold text-maroon-950">No academic terms yet</p>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">Add the school year and semester dates so Audit can match transactions to a term.</p>
                    {canWrite ? (
                      <button type="button" className="btn-primary mt-5" onClick={() => open(null)}>
                        + Add academic term
                      </button>
                    ) : null}
                  </td>
                </tr>
              ) : (
                state.items.map((term) => (
                  <tr key={term.term_id} className="tr-row">
                    <td className="td font-semibold text-slate-900">{term.term_name}</td>
                    <td className="td">{formatDate(term.start_date) || '-'}</td>
                    <td className="td">{formatDate(term.end_date) || '-'}</td>
                    {canWrite ? (
                      <td className="td">
                        <div className="flex justify-end">
                          <RowActionMenu label={`Actions for ${term.term_name}`} items={[{ label: 'Edit', onSelect: () => open(term) }]} />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
        </Table>
      </TableShell>

      {canWrite ? (
        <Modal
          open={form !== null}
          title={form?.id ? 'Edit Term' : 'Add Term'}
          dirty={formDirty}
          onClose={saving ? undefined : () => setForm(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={saving}>
                Cancel
              </button>
              <button type="submit" form="term-form" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          {form ? (
            <form id="term-form" onSubmit={save} className="space-y-4">
              <ErrorBanner message={formError} />
              <div>
                <label className="label" htmlFor="term_name">
                  Term name<RequiredMark /></label>
                <input id="term_name" className="input" value={form.term_name} onChange={(e) => setForm({ ...form, term_name: e.target.value })} required maxLength={100} autoFocus />
                {fieldErrors.term_name ? <p className="mt-1 text-xs text-red-700">{fieldErrors.term_name}</p> : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="start_date">
                    Start date<RequiredMark /></label>
                  <input id="start_date" type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required aria-describedby="start_date-hint" />
                  <DateHint id="start_date-hint" />
                  {fieldErrors.start_date ? <p className="mt-1 text-xs text-red-700">{fieldErrors.start_date}</p> : null}
                </div>
                <div>
                  <label className="label" htmlFor="end_date">
                    End date<RequiredMark /></label>
                  <input id="end_date" type="date" className="input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} required aria-describedby="end_date-hint" />
                  <DateHint id="end_date-hint" />
                  {fieldErrors.end_date ? <p className="mt-1 text-xs text-red-700">{fieldErrors.end_date}</p> : null}
                </div>
              </div>
            </form>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
