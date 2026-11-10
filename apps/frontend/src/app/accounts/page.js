'use client';

import { fetchEveryPage, pageSlice, sortNewestFirst } from '../../lib/ui/newest-first.js';
import RecordOption from '../../components/forms/RecordOption.js';
import { isSelectable } from '../../lib/ui/record-status.js';
import PasswordField from '../../components/forms/PasswordField.js';
import { passwordStatus } from '../../lib/ui/password-guidance.js';
import SubmitButton from '../../components/ui/SubmitButton.js';
import { notify } from '../../lib/ui/notify.js';
import { MESSAGES, saveFailureMessage, savedMessage } from '../../lib/ui/save-feedback.js';
import SearchInput from '../../components/forms/SearchInput.js';
import ClearFiltersButton from '../../components/forms/ClearFiltersButton.js';
import { RequiredMark } from '../../components/forms/Field.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROLES, ROLE_LABELS, ROLE_LIST, isOfficeBound } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import Modal from '../../components/modals/Modal.js';
import RowActionMenu from '../../components/ui/RowActionMenu.js';
import StatusBadge from '../../components/ui/StatusBadge.js';
import RoleBadge from '../../components/ui/RoleBadge.js';
import TableState from '../../components/ui/TableState.js';
import Pager from '../../components/navigation/Pager.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import { ACCOUNTS_API } from '../../lib/api/identity.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { apiFetch } from '../../lib/auth/session.js';
import { useFormDirty } from '../../lib/ui/useFormDirty.js';
import { POSITION_MAX, accountBody, accountToForm, accountsParams, positionCounter, positionError, positionLabel } from '../../lib/ui/account-position.js';
import { FieldError } from '../../components/forms/Field.js';

const DEFAULT_PAGE_SIZE = 10;
const EMPTY_FORM = { employee_no: '', full_name: '', email: '', role: ROLES.OFFICE_STAFF, office_id: '', position: '', password: '' };
const NO_FILTERS = { q: '', role: '', office_id: '', status: 'active', position: '' };

function AccountsManager() {
  const [filters, setFilters] = useState({ ...NO_FILTERS });
  const [appliedQuery, setAppliedQuery] = useState('');
  const [appliedPosition, setAppliedPosition] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [list, setList] = useState({ loading: true, items: [], total: 0, error: null });
  const [offices, setOffices] = useState([]);
  const [form, setForm] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { type: 'deactivate' | 'reset', account }
  const formDirty = useFormDirty(form);

  // Fallback focus. The control that started an action (a row's "⋮" button, or Add Account) is
  // remembered in pendingTrigger. Once the action has finished and its dialogs are closed, and ONLY
  // if that control is gone from the page (e.g. its row was filtered out by the reload) and focus has
  // fallen to <body>, focus goes to Add Account. Nothing runs when no action is pending, and focus the
  // user has moved elsewhere is never taken.
  const pendingTrigger = useRef(null);
  const addButtonRef = useRef(null);
  function rememberTrigger() {
    const active = document.activeElement;
    pendingTrigger.current = active && active !== document.body ? active : null;
  }
  // list is a dependency so this re-checks once a reload has been applied to the page.
  useEffect(() => {
    const trigger = pendingTrigger.current;
    if (!trigger || busy || form !== null || confirm !== null) return;
    pendingTrigger.current = null;
    if (trigger.isConnected) return; // still there: the dialog (or menu) already returned focus to it
    const active = document.activeElement;
    if (!active || active === document.body) addButtonRef.current?.focus();
  }, [list, form, confirm, busy]);

  // Offices come from the Catalogue service (accounts only store the office ID).
  useEffect(() => {
    apiFetch(OFFICES_API)
      .then((data) => setOffices(data.items))
      .catch((err) => setList((current) => ({ ...current, error: `Offices could not be loaded: ${err.message}` })));
  }, []);

  // Search waits for a short pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedQuery(filters.q);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.q]);

  // The position filter waits for a pause in typing too; the service does the matching (any letter case, part of a title).
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedPosition(filters.position);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.position]);

  // Depend on the individual filter values, not the whole `filters` object: that object is replaced on
  // every keystroke in the search box, which would re-run the request before the debounce above fires.
  const { role, office_id, status } = filters;
  // Number of the newest request. A response that is no longer the newest (an older search, or a
  // reload after save/deactivate/reactivate/reset that a later request has overtaken) is ignored.
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    setList((current) => ({ ...current, loading: true, error: null }));
    try {
      // The service returns accounts A to Z in pages, so all pages of this search are read and ordered newest first here.
      const all = await fetchEveryPage(apiFetch, (pageNo, size) => {
        return `${ACCOUNTS_API}?${accountsParams({ page: pageNo, pageSize: size, q: appliedQuery, role, office_id, status, position: appliedPosition })}`;
      });
      if (request !== latestRequest.current) return;
      const items = sortNewestFirst(all);
      setList({ loading: false, items, total: items.length, error: null });
    } catch (err) {
      if (request !== latestRequest.current) return;
      setList((current) => ({ ...current, loading: false, error: err.message }));
    }
  }, [appliedQuery, appliedPosition, role, office_id, status]);

  useEffect(() => {
    load();
  }, [load]);

  const officeById = useMemo(() => new Map(offices.map((o) => [o.office_id, o])), [offices]);
  const officeLabel = (id) => {
    if (!id) return '—';
    const office = officeById.get(id);
    return office ? `${office.office_name}${office.is_active ? '' : ' (inactive)'}` : 'Unknown office';
  };
  // Inactive offices cannot be assigned, except the one an account already has (so the edit form can show it).

  // A new page size starts again at page 1; the filters and search stay as they are.
  function changePageSize(size) {
    setPageSize(size);
    setPage(1);
  }

  function setFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    if (key !== 'q' && key !== 'position') setPage(1);
  }

  function openForm(account) {
    rememberTrigger();
    setFieldErrors({});
    setForm(
      account ? accountToForm(account) : { ...EMPTY_FORM },
    );
  }

  function changeRole(role) {
    setForm((current) => ({ ...current, role, office_id: isOfficeBound(role) ? current.office_id : '' }));
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return; // one request at a time
    if (!form.id) {
      // Only what Identity itself would refuse stops the request here (see lib/ui/password-guidance.js).
      const password = passwordStatus(form.password);
      if (password.blocking) {
        setFieldErrors({ password: password.message });
        notify.error(MESSAGES.validation);
        return;
      }
    }
    const tooLong = positionError(form.position);
    if (tooLong) {
      setFieldErrors({ position: tooLong });
      notify.error(MESSAGES.validation);
      return;
    }
    setBusy(true);
    setFieldErrors({});
    try {
      const body = accountBody(form, { officeBound: isOfficeBound(form.role) });
      if (form.id) await apiFetch(`${ACCOUNTS_API}/${form.id}`, { method: 'PUT', body });
      else await apiFetch(ACCOUNTS_API, { method: 'POST', body: { ...body, password: form.password } });
      setForm(null);
      notify.success(savedMessage('Account', form.id ? 'updated' : 'created')); // only after the server confirmed
      await load();
    } catch (err) {
      setFieldErrors(err.details && typeof err.details === 'object' ? err.details : {});
      // The modal stays open with what was typed; field problems show under their fields, and one notification says it failed.
      notify.error(saveFailureMessage(err, err.message));
    } finally {
      setBusy(false);
    }
  }

  async function runConfirmed() {
    const { type, account } = confirm;
    setBusy(true);
    try {
      if (type === 'deactivate') {
        await apiFetch(`${ACCOUNTS_API}/${account.account_id}/deactivate`, { method: 'PATCH' });
        notify.success(`${account.full_name} was deactivated and signed out.`);
      } else {
        const result = await apiFetch(`${ACCOUNTS_API}/${account.account_id}/reset-password`, { method: 'POST' });
        notify.success(result?.message || 'Password reset link sent.');
      }
      setConfirm(null);
      await load();
    } catch (err) {
      setConfirm(null);
      notify.error(saveFailureMessage(err, err.message));
    } finally {
      setBusy(false);
    }
  }

  function askConfirm(type, account) {
    rememberTrigger();
    setConfirm({ type, account });
  }

  async function reactivate(account) {
    rememberTrigger();
    setBusy(true);
    try {
      await apiFetch(`${ACCOUNTS_API}/${account.account_id}/reactivate`, { method: 'PATCH' });
      notify.success(`${account.full_name} was reactivated.`);
      await load();
    } catch (err) {
      notify.error(saveFailureMessage(err, err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={list.error} onDismiss={() => setList((current) => ({ ...current, error: null }))} />

      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
          <div className="w-full sm:w-64">
            <label className="label" htmlFor="account-search">Search name</label>
            <SearchInput id="account-search" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
          </div>
          <div className="w-full sm:w-56">
            <label className="label" htmlFor="filter-position">Position</label>
            <SearchInput id="filter-position" value={filters.position} onChange={(e) => setFilter('position', e.target.value)} />
          </div>
          <div className="w-full sm:w-44">
            <label className="label" htmlFor="filter-role">Role</label>
            <select id="filter-role" className="input select-chevron" value={filters.role} onChange={(e) => setFilter('role', e.target.value)}>
              <option value="">All roles</option>
              {ROLE_LIST.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-56">
            <label className="label" htmlFor="filter-office">Office</label>
            <select id="filter-office" className="input select-chevron" value={filters.office_id} onChange={(e) => setFilter('office_id', e.target.value)}>
              <option value="">All offices</option>
              {offices.filter((o) => isSelectable(o) || filters.status !== 'active' || o.office_id === filters.office_id).map((o) => (
                <RecordOption key={o.office_id} record={o} value={o.office_id}>{o.office_name}</RecordOption>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-36">
            <label className="label" htmlFor="filter-status">Status</label>
            <select id="filter-status" className="input select-chevron" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          {filters.q.trim() || filters.position.trim() || filters.role || filters.office_id || filters.status !== 'active' ? (
            <ClearFiltersButton
              className="w-full sm:w-auto"
              onClick={() => {
                setFilters({ ...NO_FILTERS });
                setAppliedQuery('');
                setAppliedPosition('');
                setPage(1);
              }}
            />
          ) : null}
          <div className="w-full sm:ml-auto sm:w-auto">
            <button ref={addButtonRef} type="button" className="btn-primary w-full sm:w-auto" onClick={() => openForm(null)}>+ Add Account</button>
          </div>
        </div>
      </div>

      <TableShell footer={<Pager page={page} pageSize={pageSize} total={list.total} onPage={setPage} onPageSizeChange={changePageSize} loading={list.loading} />}>
        <Table
          busy={list.loading}
          minWidth="60rem"
          head={
            <tr>
              <Th>Name</Th>
              <Th>Position</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Office</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </tr>
          }
        >
              {list.loading ? (
                <TableState colSpan={7} kind="loading">Loading accounts…</TableState>
              ) : list.items.length === 0 ? (
                <TableState colSpan={7}>No accounts match.</TableState>
              ) : (
                pageSlice(list.items, page, pageSize).rows.map((account) => (
                  <tr key={account.account_id} className={`tr-row ${account.is_active ? '' : 'bg-table-hover'}`}>
                    <td className="td">
                      <p className="font-semibold text-slate-900">{account.full_name}</p>
                      <p className="text-xs text-slate-500">{account.employee_no}</p>
                    </td>
                    <td className="td" data-testid="account-position">{positionLabel(account.position)}</td>
                    <td className="td">{account.email}</td>
                    <td className="td"><RoleBadge role={account.role} /></td>
                    <td className="td">{officeLabel(account.office_id)}</td>
                    <td className="td">
                      <StatusBadge variant={account.is_active ? 'active' : 'inactive'}>{account.is_active ? 'Active' : 'Inactive'}</StatusBadge>
                    </td>
                    <td className="td">
                      <div className="flex justify-end">
                        <RowActionMenu
                          label={`Actions for ${account.full_name}`}
                          items={
                            account.is_active
                              ? [
                                  { label: 'Edit', onSelect: () => openForm(account) },
                                  { label: 'Reset password', onSelect: () => askConfirm('reset', account) },
                                  { label: 'Deactivate', danger: true, onSelect: () => askConfirm('deactivate', account) },
                                ]
                              : [
                                  { label: 'Edit', onSelect: () => openForm(account) },
                                  { label: 'Reactivate', disabled: busy, onSelect: () => reactivate(account) },
                                ]
                          }
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
        title={form?.id ? 'Edit Account' : 'Add Account'}
        dirty={formDirty}
        onClose={busy ? undefined : () => setForm(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
            <SubmitButton form="account-form" busy={busy} label="Save" busyLabel={form?.id ? 'Updating…' : 'Creating…'} />
          </>
        }
      >
        {form ? (
          <form id="account-form" onSubmit={save} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="employee_no">Employee no.<RequiredMark /></label>
                <input id="employee_no" className="input" value={form.employee_no} onChange={(e) => setForm({ ...form, employee_no: e.target.value })} required autoFocus />
                {fieldErrors.employee_no ? <p className="mt-1 text-xs text-red-700">{fieldErrors.employee_no}</p> : null}
              </div>
              <div>
                <label className="label" htmlFor="full_name">Full name<RequiredMark /></label>
                <input id="full_name" className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
                {fieldErrors.full_name ? <p className="mt-1 text-xs text-red-700">{fieldErrors.full_name}</p> : null}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="email">Email<RequiredMark /></label>
              <input id="email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              {fieldErrors.email ? <p className="mt-1 text-xs text-red-700">{fieldErrors.email}</p> : null}
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label className="label" htmlFor="position">Position / Designation</label>
                <span className={`text-xs ${positionError(form.position) ? 'font-semibold text-red-700' : 'text-slate-500'}`} data-testid="position-counter" aria-live="polite">{positionCounter(form.position)}</span>
              </div>
              <input
                id="position"
                className="input"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
                onBlur={(e) => setForm((current) => (current ? { ...current, position: e.target.value.trim() } : current))}
                aria-invalid={fieldErrors.position ? 'true' : undefined}
                aria-describedby="position-help position-error"
                autoComplete="off"
              />
              <p id="position-help" className="mt-1 text-xs text-slate-500">Optional. A label shown on screens, such as &ldquo;Administrative Aide III&rdquo;. Up to {POSITION_MAX} characters. It does not change what the person can do.</p>
              <FieldError id="position-error">{fieldErrors.position}</FieldError>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="role">Role</label>
                <select id="role" className="input" value={form.role} onChange={(e) => changeRole(e.target.value)}>
                  {ROLE_LIST.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
                {fieldErrors.role ? <p className="mt-1 text-xs text-red-700">{fieldErrors.role}</p> : null}
              </div>
              {isOfficeBound(form.role) ? (
                <div>
                  <label className="label" htmlFor="office_id">Office<RequiredMark /></label>
                  <select id="office_id" className="input" value={form.office_id} onChange={(e) => setForm({ ...form, office_id: e.target.value })}>
                    <option value="">Select an office</option>
                    {offices.filter((o) => isSelectable(o) || o.office_id === form.office_id).map((o) => (
                      <RecordOption key={o.office_id} record={o} value={o.office_id}>{o.office_name}</RecordOption>
                    ))}
                  </select>
                  {fieldErrors.office_id ? <p className="mt-1 text-xs text-red-700">{fieldErrors.office_id}</p> : null}
                </div>
              ) : null}
            </div>
            {!form.id ? (
              <PasswordField
                value={form.password}
                onChange={(password) => setForm({ ...form, password })}
                error={fieldErrors.password ?? null}
                helper="The person can change it through a reset link."
              />
            ) : null}
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.type === 'reset' ? 'Send password reset link?' : 'Deactivate account?'}
        message={
          confirm?.type === 'reset'
            ? `A time-limited reset link will be emailed to ${confirm?.account.email}. Their current password keeps working until they use it.`
            : `${confirm?.account.full_name} will be signed out and will not be able to sign in until you reactivate the account. Their records are kept.`
        }
        confirmLabel={confirm?.type === 'reset' ? 'Send link' : 'Deactivate'}
        danger={confirm?.type === 'deactivate'}
        busy={busy}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

export default function AccountsPage() {
  return (
    <AppShell title="Accounts" subtitle="Create CCCMS accounts and control who can sign in." allowedRoles={[ROLES.SUPER_ADMIN]}>
      <AccountsManager />
    </AppShell>
  );
}
