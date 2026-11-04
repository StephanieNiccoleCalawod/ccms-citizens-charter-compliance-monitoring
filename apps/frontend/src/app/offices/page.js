'use client';

import { sortNewestFirst } from '../../lib/ui/newest-first.js';
import SubmitButton from '../../components/ui/SubmitButton.js';
import { notify } from '../../lib/ui/notify.js';
import { saveFailureMessage, savedMessage } from '../../lib/ui/save-feedback.js';
import SearchInput from '../../components/forms/SearchInput.js';
import ClearFiltersButton from '../../components/forms/ClearFiltersButton.js';
import { RequiredMark } from '../../components/forms/Field.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import OfficeCodeField from '../../components/forms/OfficeCodeField.js';
import Modal from '../../components/modals/Modal.js';
import RowActionMenu from '../../components/ui/RowActionMenu.js';
import StatusBadge from '../../components/ui/StatusBadge.js';
import TableState from '../../components/ui/TableState.js';
import InstitutionCodePanel from '../../components/offices/InstitutionCodePanel.js';
import { CATALOGUE_SETTINGS_API, OFFICES_API } from '../../lib/api/catalogue.js';
import { apiFetch } from '../../lib/auth/session.js';
import { INSTITUTION_UNAVAILABLE_MESSAGE, officeCodeProblem, officePart, officeRequestBody, officeSaveError } from '../../lib/ui/office-code.js';
import { useFormDirty } from '../../lib/ui/useFormDirty.js';

// office_code in this form is the OFFICE PART ("OSAS"); Core builds the full code "PUP-OSAS" from the institution code and sends it back.
// currentCode: an existing office whose saved code does not start with the institution code yet (shown as a note).
const EMPTY_FORM = { office_code: '', office_name: '', currentCode: null };

function OfficesManager() {
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(''); // '' = all, 'active', 'inactive'
  const [settings, setSettings] = useState({ loading: true, code: null, error: null }); // the institution code, from Core
  const [form, setForm] = useState(null); // { id?, office_code (the office part), office_name, currentCode }
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // office being deactivated
  const formDirty = useFormDirty(form);

  const reload = useCallback(async () => {
    try {
      const data = await apiFetch(OFFICES_API);
      setState({ loading: false, items: data.items, error: null });
    } catch (err) {
      setState((current) => ({ ...current, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // The institution code comes from Core. Nothing is assumed: while it is unknown or unavailable, offices cannot be added or edited.
  const loadSettings = useCallback(async () => {
    setSettings((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await apiFetch(CATALOGUE_SETTINGS_API);
      setSettings({ loading: false, code: data?.settings?.institution_code ?? null, error: null });
    } catch (err) {
      setSettings({ loading: false, code: null, error: err.status === 403 ? err.message : INSTITUTION_UNAVAILABLE_MESSAGE });
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const prefix = settings.code; // null until Core has one

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    // Newest first (by created_at), so an office that was just added is the first row.
    return sortNewestFirst(state.items).filter(
      (o) =>
        (status === '' || (status === 'active') === o.is_active) &&
        (!term || o.office_code.toLowerCase().includes(term) || o.office_name.toLowerCase().includes(term)),
    );
  }, [state.items, search, status]);

  function openForm(office) {
    setFieldErrors({});
    if (!prefix) return; // Core cannot build a code without the institution code
    if (!office) {
      setForm({ ...EMPTY_FORM });
      return;
    }
    // Edit only the office part of "PUP-OSAS", so saving never writes the institution code twice.
    const part = officePart(prefix, office.office_code);
    setForm({ id: office.office_id, office_code: part ?? '', office_name: office.office_name, currentCode: part === null ? office.office_code : null });
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return; // one request at a time
    const problem = officeCodeProblem(prefix, form.office_code);
    if (problem) {
      setFieldErrors({ office_code: problem });
      notify.error(saveFailureMessage({ status: 400, details: { office_code: problem } }));
      return;
    }
    setSaving(true);
    setFieldErrors({});
    try {
      const body = officeRequestBody(form.office_code, form.office_name); // { office_abbr, office_name }: Core builds the full code
      if (form.id) await apiFetch(`${OFFICES_API}/${form.id}`, { method: 'PUT', body });
      else await apiFetch(OFFICES_API, { method: 'POST', body });
      setForm(null);
      notify.success(savedMessage('Office', form.id ? 'updated' : 'created')); // only after the server confirmed
      await reload();
    } catch (err) {
      // The service answers 409 for a code or name already in use, 400 with the field that is wrong, 409 when the institution code is
      // missing or the code cannot change; officeSaveError turns those, 403 and network or server failures into plain messages.
      const { fieldErrors: fields, message } = officeSaveError(err, prefix);
      setFieldErrors(fields);
      notify.error(saveFailureMessage(err, message)); // the form stays open with what was typed
    } finally {
      setSaving(false);
    }
  }

  async function setActive(office, active) {
    setSaving(true);
    try {
      await apiFetch(`${OFFICES_API}/${office.office_id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'PATCH' });
      setConfirm(null);
      notify.success(savedMessage('Office', active ? 'reactivated' : 'deactivated'));
      await reload();
    } catch (err) {
      setConfirm(null);
      notify.error(saveFailureMessage(err, err.message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: null }))} />

      <InstitutionCodePanel
        settings={settings}
        onRetry={loadSettings}
        onSaved={(code) => setSettings({ loading: false, code, error: null })}
      />

      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
          <div className="w-full sm:w-72">
            <label className="label" htmlFor="office-search">
              Search office
            </label>
            <SearchInput id="office-search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="w-full sm:w-40">
            <label className="label" htmlFor="office-status">
              Status
            </label>
            <select id="office-status" className="input select-chevron" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          {search.trim() || status ? (
            <ClearFiltersButton className="w-full sm:w-auto" onClick={() => {
                setSearch('');
                setStatus('');
              }} />
          ) : null}
          <button type="button" className="btn-primary w-full sm:ml-auto sm:w-auto" onClick={() => openForm(null)} disabled={!prefix} title={prefix ? undefined : 'Set the institution code first'}>
            + Add Office
          </button>
        </div>
      </div>

      <TableShell>
        <Table
          busy={state.loading}
          head={
            <tr>
              <Th>Office name</Th>
              <Th>Office code</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </tr>
          }
        >
              {state.loading ? (
                <TableState colSpan={4} kind="loading">Loading offices…</TableState>
              ) : visible.length === 0 ? (
                <TableState colSpan={4}>
                  {state.items.length === 0 ? 'No offices yet. Add the first office from the Citizen’s Charter.' : 'No offices match your search or filter.'}
                </TableState>
              ) : (
                visible.map((office) => (
                  <tr key={office.office_id} className={`tr-row ${office.is_active ? '' : 'bg-table-hover'}`}>
                    <td className="td">{office.office_name}</td>
                    <td className="td whitespace-nowrap font-mono font-semibold text-slate-700" data-testid="office-code">{office.office_code}</td>
                    <td className="td">
                      <StatusBadge variant={office.is_active ? 'active' : 'inactive'}>{office.is_active ? 'Active' : 'Inactive'}</StatusBadge>
                    </td>
                    <td className="td">
                      <div className="flex justify-end">
                        <RowActionMenu
                          label={`Actions for ${office.office_name}`}
                          items={[
                            { label: 'Edit', disabled: !prefix, onSelect: () => openForm(office) },
                            office.is_active
                              ? { label: 'Deactivate', danger: true, onSelect: () => setConfirm(office) }
                              : { label: 'Reactivate', disabled: saving, onSelect: () => setActive(office, true) },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
        </Table>
      </TableShell>

      <Modal
        open={form !== null}
        title={form?.id ? 'Edit Office' : 'Add Office'}
        dirty={formDirty}
        onClose={saving ? undefined : () => setForm(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={saving}>
              Cancel
            </button>
            <SubmitButton form="office-form" busy={saving} label="Save" busyLabel={form?.id ? 'Updating…' : 'Creating…'} />
          </>
        }
      >
        {form ? (
          <form id="office-form" onSubmit={save} className="space-y-4">
            <OfficeCodeField
              prefix={prefix}
              currentCode={form.currentCode}
              value={form.office_code}
              onChange={(value) => setForm({ ...form, office_code: value })}
              error={fieldErrors.office_code}
              autoFocus
            />
            <div>
              <label className="label" htmlFor="office_name">
                Office name (as printed in the Charter)<RequiredMark /></label>
              <input id="office_name" className="input" value={form.office_name} onChange={(e) => setForm({ ...form, office_name: e.target.value })} required maxLength={200} aria-invalid={fieldErrors.office_name ? true : undefined} />
              {fieldErrors.office_name ? <p className="mt-1 text-xs text-red-700">{fieldErrors.office_name}</p> : null}
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title="Deactivate office?"
        message={
          confirm
            ? `${confirm.office_name} will no longer be offered when adding accounts or services. Existing records that use it keep showing it. You can reactivate it later.`
            : ''
        }
        confirmLabel="Deactivate"
        danger
        busy={saving}
        onConfirm={() => setActive(confirm, false)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

export default function OfficesPage() {
  return (
    <AppShell title="Offices" subtitle="The office list as printed in the Citizen's Charter." allowedRoles={[ROLES.SUPER_ADMIN]}>
      <OfficesManager />
    </AppShell>
  );
}
