'use client';

import RecordOption from '../../components/forms/RecordOption.js';
import { RequiredMark } from '../../components/forms/Field.js';
import { useCallback, useEffect, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import Modal from '../../components/modals/Modal.js';
import RowActionMenu from '../../components/ui/RowActionMenu.js';
import StatusBadge from '../../components/ui/StatusBadge.js';
import TableState from '../../components/ui/TableState.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { deactivateCounter, listCounters, reactivateCounter } from '../../lib/api/operations.js';
import { apiFetch } from '../../lib/auth/session.js';
import { COUNTER_LABEL_MAX, counterErrorResult, saveCounter } from '../../lib/ui/transaction-settings.js';
import { useFormDirty } from '../../lib/ui/useFormDirty.js';

/**
 * Counters of one office. Shown by the settings page only while Counters Enabled is on. Super Admin picks
 * the office and can add, rename, deactivate and reactivate; Office Head and Office Staff see their own
 * office read-only. The service enforces who may do what and that a label is unique per office in any
 * letter case; this screen just explains its answers.
 */
export default function Counters({ user, canWrite }) {
  const ownOffice = user.role !== ROLES.SUPER_ADMIN;
  const [offices, setOffices] = useState({ loading: !ownOffice, items: [], error: null });
  const [officeId, setOfficeId] = useState(ownOffice ? (user.officeId ?? '') : '');
  const [ownOfficeName, setOwnOfficeName] = useState(null);
  // officeId says which office `items` belong to, so another office's rows are never shown under this one.
  const [list, setList] = useState({ officeId: '', loading: Boolean(ownOffice && user.officeId), items: [], error: null });
  const [form, setForm] = useState(null); // { id?, office_id, label }
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [confirm, setConfirm] = useState(null); // counter being deactivated
  const [saving, setSaving] = useState(false);
  const formDirty = useFormDirty(form);

  // Super Admin: every office, to pick from. Everyone else: just the name of their own office, as a label.
  useEffect(() => {
    let cancelled = false;
    if (ownOffice) {
      if (!user.officeId) return undefined;
      apiFetch(`${OFFICES_API}/${encodeURIComponent(user.officeId)}`)
        .then((data) => !cancelled && setOwnOfficeName(data.office ? data.office.office_name : null))
        .catch(() => !cancelled && setOwnOfficeName(null)); // the name is only a label
      return () => {
        cancelled = true;
      };
    }
    apiFetch(OFFICES_API)
      .then((data) => {
        if (cancelled) return;
        const items = data.items ?? [];
        setOffices({ loading: false, items, error: null });
        setOfficeId((current) => current || (items.find((o) => o.is_active) ?? items[0])?.office_id || '');
      })
      .catch((err) => !cancelled && setOffices({ loading: false, items: [], error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [ownOffice, user.officeId]);

  const reload = useCallback(async () => {
    if (!officeId) return;
    setList((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await listCounters(officeId);
      setList({ officeId, loading: false, items: data.items ?? [], error: null });
    } catch (err) {
      setList({ officeId, loading: false, items: [], error: counterErrorResult(err).message });
    }
  }, [officeId]);

  useEffect(() => {
    reload();
  }, [reload]);

  function openForm(counter) {
    setFieldErrors({});
    setFormError(null);
    setForm(counter ? { id: counter.counter_id, office_id: counter.office_id, label: counter.label } : { office_id: officeId, label: '' });
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    const result = await saveCounter(form);
    setSaving(false);
    if (result.ok) {
      setForm(null);
      await reload();
      return;
    }
    setFieldErrors(result.fieldErrors ?? {});
    setFormError(result.message);
  }

  async function setActive(counter, active) {
    if (saving) return;
    setSaving(true);
    try {
      await (active ? reactivateCounter(counter.counter_id) : deactivateCounter(counter.counter_id));
      setConfirm(null);
      await reload();
    } catch (err) {
      setConfirm(null);
      setList((current) => ({ ...current, error: counterErrorResult(err).message }));
    } finally {
      setSaving(false);
    }
  }

  const noOffice = ownOffice && !user.officeId;
  const columns = canWrite ? 3 : 2;
  const rows = list.officeId === officeId ? list.items : [];
  const showLoading = list.loading && rows.length === 0;

  return (
    <section className="space-y-4" aria-labelledby="counters-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="counters-heading" className="text-lg">
            Counters
          </h2>
          <p className="mt-1 text-sm text-slate-500">Service windows an office can pick when it starts a transaction.</p>
        </div>
        {canWrite ? (
          <button type="button" className="btn-primary" onClick={() => openForm(null)} disabled={!officeId}>
            + Add Counter
          </button>
        ) : null}
      </div>

      <ErrorBanner message={offices.error} />
      <ErrorBanner message={list.error} onDismiss={() => setList((current) => ({ ...current, error: null }))} />

      <div className="card p-4">
        {ownOffice ? (
          <p className="text-sm text-slate-600" data-testid="own-office">
            Office <span className="font-semibold text-slate-900">{noOffice ? 'Not linked to an office' : (ownOfficeName ?? '—')}</span>
          </p>
        ) : (
          <div className="w-full sm:w-96">
            <label className="label" htmlFor="counter-office">
              Office
            </label>
            <select id="counter-office" className="input" value={officeId} onChange={(e) => setOfficeId(e.target.value)} disabled={offices.loading || offices.items.length === 0}>
              {offices.loading ? <option value="">Loading offices…</option> : null}
              {!offices.loading && offices.items.length === 0 ? <option value="">No offices yet</option> : null}
              {offices.items.map((o) => (
                <RecordOption key={o.office_id} record={o} value={o.office_id}>{o.office_name}</RecordOption>
              ))}
            </select>
          </div>
        )}
      </div>

      <TableShell>
        <Table
          busy={showLoading}
          head={
            <tr>
              <Th>Counter</Th>
              <Th>Status</Th>
              {canWrite ? <Th align="right">Actions</Th> : null}
            </tr>
          }
        >
              {showLoading ? (
                <TableState colSpan={columns} kind="loading">Loading counters…</TableState>
              ) : !officeId ? (
                <TableState colSpan={columns}>{noOffice ? 'Your account is not linked to an office.' : 'Choose an office to see its counters.'}</TableState>
              ) : rows.length === 0 ? (
                <TableState colSpan={columns}>{list.error ? 'The counters could not be loaded.' : 'This office has no counters yet.'}</TableState>
              ) : (
                rows.map((counter) => (
                  <tr key={counter.counter_id} className={`tr-row ${counter.is_active ? '' : 'bg-table-hover'}`}>
                    <td className="td font-semibold text-slate-900">{counter.label}</td>
                    <td className="td">
                      <StatusBadge variant={counter.is_active ? 'active' : 'inactive'}>{counter.is_active ? 'Active' : 'Inactive'}</StatusBadge>
                    </td>
                    {canWrite ? (
                      <td className="td">
                        <div className="flex justify-end">
                          <RowActionMenu
                            label={`Actions for ${counter.label}`}
                            items={[
                              { label: 'Edit', onSelect: () => openForm(counter) },
                              counter.is_active
                                ? { label: 'Deactivate', danger: true, onSelect: () => setConfirm(counter) }
                                : { label: 'Reactivate', disabled: saving, onSelect: () => setActive(counter, true) },
                            ]}
                          />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
        </Table>
      </TableShell>

      <Modal
        open={form !== null}
        title={form?.id ? 'Edit Counter' : 'Add Counter'}
        dirty={formDirty}
        onClose={saving ? undefined : () => setForm(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="counter-form" className="btn-save" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        {form ? (
          <form id="counter-form" onSubmit={save} className="space-y-4" noValidate>
            <ErrorBanner message={formError} />
            <div>
              <label className="label" htmlFor="counter_label">
                Counter label<RequiredMark /></label>
              <input
                id="counter_label"
                className="input"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                maxLength={COUNTER_LABEL_MAX}
                autoFocus
                required
                aria-invalid={fieldErrors.label ? true : undefined}
                aria-describedby={fieldErrors.label ? 'counter_label-error' : undefined}
              />
              {fieldErrors.label ? (
                <p id="counter_label-error" className="mt-1 text-xs text-red-700">
                  {fieldErrors.label}
                </p>
              ) : null}
              {fieldErrors.office_id ? <p className="mt-1 text-xs text-red-700">{fieldErrors.office_id}</p> : null}
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title="Deactivate counter?"
        message={confirm ? `"${confirm.label}" will no longer be offered when starting transactions. It is kept in the records and can be reactivated later.` : ''}
        confirmLabel="Deactivate"
        danger
        busy={saving}
        onConfirm={() => setActive(confirm, false)}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
