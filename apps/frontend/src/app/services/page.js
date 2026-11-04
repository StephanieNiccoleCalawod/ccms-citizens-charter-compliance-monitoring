'use client';

import { fetchEveryPage, pageSlice, sortNewestFirst } from '../../lib/ui/newest-first.js';
import RecordOption from '../../components/forms/RecordOption.js';
import { isSelectable } from '../../lib/ui/record-status.js';
import SubmitButton from '../../components/ui/SubmitButton.js';
import { notify } from '../../lib/ui/notify.js';
import { saveFailureMessage, savedMessage } from '../../lib/ui/save-feedback.js';
import SearchInput from '../../components/forms/SearchInput.js';
import ClearFiltersButton from '../../components/forms/ClearFiltersButton.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import Modal from '../../components/modals/Modal.js';
import DataTable from '../../components/ui/DataTable.js';
import RowActionMenu from '../../components/ui/RowActionMenu.js';
import StatusBadge from '../../components/ui/StatusBadge.js';
import ServiceForm, { EMPTY_SERVICE_FORM, formToBody, serviceToForm } from '../../components/forms/ServiceForm.js';
import { toQuery } from '../../lib/api/client.js';
import { CATALOGUE_API, CLASSIFICATIONS, classificationLabel } from '../../lib/api/catalogue.js';
import { apiFetch } from '../../lib/auth/session.js';
import { useFormDirty } from '../../lib/ui/useFormDirty.js';
import { serviceSaveError } from '../../lib/ui/service-form.js';
import { useSingleSubmit } from '../../lib/ui/useSingleSubmit.js';

const API = CATALOGUE_API;
const DEFAULT_PAGE_SIZE = 20;

function OfficePill({ user }) {
  const [office, setOffice] = useState(null);

  useEffect(() => {
    if (!user.officeId) return;
    apiFetch(`${API}/offices/${encodeURIComponent(user.officeId)}`)
      .then((data) => setOffice(data.office ?? null))
      .catch(() => setOffice(null)); // the name is only a label
  }, [user.officeId]);

  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-[#EAE3D9] bg-white px-4 py-2 text-sm text-slate-500" data-testid="own-office">
      Your office
      <span className="font-semibold text-slate-900">{office ? office.office_name : '—'}</span>
    </p>
  );
}

function ServicesManager({ user }) {
  const isAdmin = user.role === ROLES.SUPER_ADMIN;
  // Office Head and Office Staff only ever see their own office's services (the API enforces it too).
  const ownOfficeOnly = user.role === ROLES.OFFICE_HEAD || user.role === ROLES.OFFICE_STAFF;
  const [filters, setFilters] = useState({ search: '', office_id: '', classification: '', status: 'active' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [offices, setOffices] = useState([]);
  const [state, setState] = useState({ loading: true, items: [], total: 0, error: null });
  const [form, setForm] = useState(null); // { id?, ...fields }
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const formDirty = useFormDirty(form);
  const once = useSingleSubmit();

  useEffect(() => {
    if (ownOfficeOnly) return; // own-office users have no office filter
    apiFetch(`${API}/offices`)
      .then((data) => setOffices(data.items ?? []))
      .catch(() => setOffices([])); // the office filter is optional
  }, [ownOfficeOnly]);

  const latestRequest = useRef(0); // only the newest request may update the table
  const reload = useCallback(async () => {
    const request = ++latestRequest.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // The service returns services A to Z in pages, so all pages of this search are read and ordered newest first here.
      const all = await fetchEveryPage(apiFetch, (pageNo, size) => `${API}/services${toQuery({ ...applied, office_id: ownOfficeOnly ? undefined : applied.office_id, status: isAdmin ? applied.status : undefined, page: pageNo, page_size: size })}`);
      if (request !== latestRequest.current) return;
      const items = sortNewestFirst(all);
      setState({ loading: false, items, total: items.length, error: null });
    } catch (err) {
      if (request !== latestRequest.current) return;
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [applied, isAdmin, ownOfficeOnly]);

  useEffect(() => {
    reload();
  }, [reload]);

  // A new page size starts again at page 1; the filters stay as they are.
  function changePageSize(size) {
    setPageSize(size);
    setPage(1);
  }

  const sameFilters = (a, b) => a.search.trim() === b.search.trim() && a.office_id === b.office_id && a.classification === b.classification && a.status === b.status;

  // The search applies after a short pause in typing (Enter, or leaving the field, applies at once).
  useEffect(() => {
    if (sameFilters(filters, applied)) return undefined;
    const timer = setTimeout(() => applyFilters(filters), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyFilters only sets state from its argument
  }, [filters, applied]);

  function applyFilters(next) {
    setFilters(next);
    if (sameFilters(next, applied)) return; // nothing changed: no second request
    setApplied(next);
    setPage(1);
    setState((s) => ({ ...s, loading: true }));
  }

  function openForm(service) {
    setFieldErrors({});
    setForm(service ? { id: service.service_id, current_standard: service.current_standard ?? null, ...serviceToForm(service) } : { ...EMPTY_SERVICE_FORM });
  }

  function save(event) {
    event.preventDefault();
    return once(async () => {
      setSaving(true);
      setFieldErrors({});
      try {
        if (form.id) {
          await apiFetch(`${API}/services/${form.id}`, { method: 'PUT', body: formToBody(form, false) });
          setForm(null);
          notify.success(savedMessage('Service', 'updated')); // only after the server confirmed
        } else {
          // The code in the message is the one Core assigned and returned, not the preview.
          const data = await apiFetch(`${API}/services`, { method: 'POST', body: formToBody(form, true) });
          setForm(null);
          notify.success(data?.service?.service_code ? `${savedMessage('Service', 'created')} Its code is ${data.service.service_code}.` : savedMessage('Service', 'created'));
        }
        await reload();
      } catch (err) {
        // The form keeps everything that was typed; the service's field errors appear under their own fields.
        const { details, message } = serviceSaveError(err); // 403, network and server failures get safe messages
        setFieldErrors(details);
        notify.error(saveFailureMessage(err, message)); // the form stays open with what was typed
      } finally {
        setSaving(false);
      }
    });
  }

  async function setActive(service, active) {
    setSaving(true);
    try {
      await apiFetch(`${API}/services/${service.service_id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'PATCH' });
      setConfirm(null);
      notify.success(savedMessage('Service', active ? 'reactivated' : 'deactivated'));
      await reload();
    } catch (err) {
      setConfirm(null);
      notify.error(saveFailureMessage(err, err.message));
    } finally {
      setSaving(false);
    }
  }


  const tableColumns = [
    {
      key: 'service',
      header: 'SERVICE',
      render: (s) => (
        <DataTable.TruncatedCell
          text={s.service_name}
          subtitle={`${s.office_name} · ${s.service_code}`}
          href={`/services/${encodeURIComponent(s.service_id)}`}
        />
      ),
    },
    {
      key: 'classification',
      header: 'CLASSIFICATION',
      width: 170,
      render: (s) => (
        <StatusBadge variant={s.classification}>
          {classificationLabel(s.classification)}
        </StatusBadge>
      ),
    },
    ...(isAdmin
      ? [
        {
          key: 'status',
          header: 'STATUS',
          width: 120,
          render: (s) => (
            <StatusBadge variant={s.is_active ? 'active' : 'inactive'}>
              {s.is_active ? 'Active' : 'Inactive'}
            </StatusBadge>
          ),
        },
      ]
      : []),
    {
      key: 'actions',
      header: 'ACTION',
      width: 104,
      align: 'right',
      render: (s) => (
        <RowActionMenu
          label={`Actions for ${s.service_name}`}
          items={[
            { label: 'View', href: `/services/${encodeURIComponent(s.service_id)}` },
            ...(isAdmin
              ? [
                { label: 'Edit', onSelect: () => openForm(s) },
                s.is_active
                  ? { label: 'Deactivate', onSelect: () => setConfirm({ service: s, active: false }) }
                  : { label: 'Reactivate', onSelect: () => setConfirm({ service: s, active: true }) },
              ]
              : []),
          ]}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: null }))} />

      <form
        className="card p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters(filters);
        }}
      >
        <div className="flex flex-wrap items-end gap-x-4 gap-y-4">
          <div className="w-full sm:w-64">
            <label className="label" htmlFor="svc-search">
              Search
            </label>
            <SearchInput id="svc-search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} onBlur={() => filters.search.trim() !== applied.search.trim() && applyFilters(filters)} />
          </div>
          {ownOfficeOnly ? null : offices.length > 0 ? (
            <div className="w-full sm:w-52">
              <label className="label" htmlFor="svc-office">
                Office
              </label>
              <select id="svc-office" className="input select-chevron" value={filters.office_id} onChange={(e) => applyFilters({ ...filters, office_id: e.target.value })}>
                <option value="">All offices</option>
                {offices.filter((o) => isSelectable(o) || filters.status !== 'active' || o.office_id === filters.office_id).map((o) => (
                  <RecordOption key={o.office_id} record={o} value={o.office_id}>{o.office_name}</RecordOption>
                ))}
              </select>
            </div>
          ) : null}
          <div className="w-full sm:w-40">
            <label className="label" htmlFor="svc-class">
              Classification
            </label>
            <select id="svc-class" className="input select-chevron" value={filters.classification} onChange={(e) => applyFilters({ ...filters, classification: e.target.value })}>
              <option value="">All</option>
              {CLASSIFICATIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          {isAdmin ? (
            <div className="w-full sm:w-32">
              <label className="label" htmlFor="svc-status">
                Status
              </label>
              <select id="svc-status" className="input select-chevron" value={filters.status} onChange={(e) => applyFilters({ ...filters, status: e.target.value })}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          ) : null}
          {applied.search.trim() || applied.office_id || applied.classification || applied.status !== 'active' ? (
            <ClearFiltersButton className="w-full sm:w-auto" onClick={() => applyFilters({ search: '', office_id: '', classification: '', status: 'active' })} />
          ) : null}
          {isAdmin ? (
            <button type="button" className="btn-primary w-full sm:ml-auto sm:w-auto" onClick={() => openForm(null)}>
              + Add Service
            </button>
          ) : null}
        </div>
      </form>

      <DataTable
        columns={tableColumns}
        data={pageSlice(state.items, page, pageSize).rows}
        keyExtractor={(s) => s.service_id}
        rowClassName={(s) => (s.is_active ? '' : 'bg-table-hover')}
        loading={state.loading}
        loadingMessage="Loading services…"
        emptyMessage="No services match your filters."
        summaryText={ownOfficeOnly ? 'Showing services of your office' : null}
        totalCount={state.total}
        countLabel="services"
        pagination={{
          page,
          pageSize,
          total: state.total,
          onPage: setPage,
          onPageSizeChange: changePageSize,
          loading: state.loading,
        }}
      />

      <Modal
        open={form !== null}
        title={form?.id ? 'Edit Service' : 'Add Service'}
        dirty={formDirty}
        widthClass="max-w-2xl"
        onClose={saving ? undefined : () => setForm(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={saving}>
              Cancel
            </button>
            <SubmitButton form="service-form" busy={saving} label="Save" busyLabel={form?.id ? 'Updating…' : 'Creating…'} />
          </>
        }
      >
        {form ? (
          <div className="space-y-4">
            <ServiceForm id="service-form" form={form} setForm={setForm} errors={fieldErrors} offices={offices} isNew={!form.id} onSubmit={save} currentStandard={form.id ? form.current_standard ?? null : null} />
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.active ? 'Reactivate service?' : 'Deactivate service?'}
        message={
          confirm
            ? confirm.active
              ? `${confirm.service.service_name} will appear again in the catalogue and on the public page.`
              : `${confirm.service.service_name} will disappear from the public page and can no longer be used to start transactions. Existing records keep it. You can reactivate it later.`
            : ''
        }
        confirmLabel={confirm?.active ? 'Reactivate' : 'Deactivate'}
        danger={confirm ? !confirm.active : false}
        busy={saving}
        onConfirm={() => setActive(confirm.service, confirm.active)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

export default function ServicesPage() {
  return (
    <AppShell
      title="Services"
      subtitle="The Citizen's Charter service catalogue."
      headerRight={(user) => (user.role === ROLES.OFFICE_HEAD || user.role === ROLES.OFFICE_STAFF ? <OfficePill user={user} /> : null)}
    >
      {(user) => <ServicesManager user={user} />}
    </AppShell>
  );
}
