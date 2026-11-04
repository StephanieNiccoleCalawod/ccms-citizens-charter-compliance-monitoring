'use client';

import { useCallback, useEffect, useState } from 'react';
import AppShell from '../../components/layout/AppShell.js';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import StatusBanner from '../../components/feedback/StatusBanner.js';
import Switch from '../../components/ui/Switch.js';
import { getSettings } from '../../lib/api/operations.js';
import {
  AUTO_CLOSE_FIELDS,
  AUTO_CLOSE_RULE,
  DEFAULT_SETTINGS,
  canChangeTransactionSettings,
  prepareSettingsSave,
  sameForm,
  saveSettings,
  settingsToForm,
  showCounters,
} from '../../lib/ui/transaction-settings.js';
import Counters from './Counters.js';

function SettingsManager({ user }) {
  const canWrite = canChangeTransactionSettings(user.role);
  const [settings, setSettings] = useState(null); // the last values the server confirmed, with their version
  const [form, setForm] = useState(settingsToForm(DEFAULT_SETTINGS));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [banner, setBanner] = useState(null); // { kind: 'success' | 'info' | 'error' | 'conflict', message }
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const apply = useCallback((latest) => {
    setSettings(latest);
    setForm(settingsToForm(latest));
    setFieldErrors({});
    setLoading(false);
  }, []);

  // First load. The page starts out loading, so nothing is set before the answer arrives.
  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((latest) => !cancelled && apply(latest))
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const dirty = settings !== null && !sameForm(form, settingsToForm(settings));
  const readOnly = !canWrite || saving;

  function edit(change) {
    setForm((current) => ({ ...current, ...change }));
    setBanner((current) => (current?.kind === 'success' ? null : current));
  }

  function onSubmit(event) {
    event.preventDefault();
    if (!canWrite || saving || !dirty) return;
    const prepared = prepareSettingsSave(form, settings.version);
    setFieldErrors(prepared.fieldErrors ?? {});
    if (!prepared.ok) {
      setBanner(prepared.message ? { kind: 'error', message: prepared.message } : null);
      return;
    }
    setBanner(null);
    setConfirmOpen(true);
  }

  async function confirmSave() {
    if (saving) return;
    setSaving(true);
    const result = await saveSettings({ form, version: settings.version });
    setSaving(false);
    setConfirmOpen(false);
    if (result.ok) {
      // The form and the version change only now, after the server accepted the save.
      setSettings(result.settings);
      setForm(settingsToForm(result.settings));
      setFieldErrors({});
      setBanner({ kind: 'success', message: 'Settings saved.' });
      return;
    }
    setFieldErrors(result.fieldErrors ?? {});
    setBanner(result.message ? { kind: result.kind === 'conflict' ? 'conflict' : 'error', message: result.message } : null);
  }

  // Loads again (Try again, or Reload latest settings after a conflict). Resolves true when the latest values are in.
  async function startLoad() {
    setLoading(true);
    setLoadError(null);
    try {
      apply(await getSettings());
      return true;
    } catch (err) {
      setLoadError(err.message);
      setLoading(false);
      return false;
    }
  }

  async function reloadLatest() {
    setBanner(null);
    if (await startLoad()) setBanner({ kind: 'info', message: 'The latest settings are loaded. Review them, then save again if you still want to change them.' });
  }

  if (loading && settings === null) return <p className="text-sm text-slate-500" role="status">Loading settings…</p>;
  if (settings === null) {
    return (
      <div className="space-y-3">
        <StatusBanner variant="error" message={loadError ?? 'The settings could not be loaded.'} />
        <button type="button" className="btn-secondary" onClick={startLoad}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!canWrite ? <StatusBanner variant="info" message="You can view these settings. Only a Super Admin can change them." /> : null}
      {banner?.kind === 'success' ? <StatusBanner variant="success" message={banner.message} onDismiss={() => setBanner(null)} /> : null}
      {banner?.kind === 'info' ? <StatusBanner variant="info" message={banner.message} onDismiss={() => setBanner(null)} /> : null}
      {banner?.kind === 'error' ? <StatusBanner variant="error" message={banner.message} onDismiss={() => setBanner(null)} dismissAriaLabel="Dismiss error" /> : null}
      {banner?.kind === 'conflict' ? (
        <StatusBanner variant="error">
          <span className="block font-semibold">{banner.message}</span>
          <span className="mt-1 block">Nothing was saved. Load the latest settings to review what changed.</span>
          <button type="button" className="btn-secondary mt-3 px-3 py-1.5" onClick={reloadLatest} disabled={loading}>
            {loading ? 'Loading…' : 'Reload latest settings'}
          </button>
        </StatusBanner>
      ) : null}

      <form onSubmit={onSubmit} noValidate aria-label="Transaction settings" className="space-y-6">
        <section className="card space-y-5 p-5" aria-labelledby="behaviour-heading">
          <h2 id="behaviour-heading" className="text-lg">
            Transactions
          </h2>
          <Switch
            label="Hold Enabled"
            description="Lets staff put a transaction on hold and resume it."
            checked={form.hold_enabled}
            onChange={(value) => edit({ hold_enabled: value })}
            disabled={readOnly}
          />
          <hr className="border-slate-100" />
          <Switch
            label="Counters Enabled"
            description="Lets staff pick a counter when they start a transaction. Counters are managed below once this is on."
            checked={form.counters_enabled}
            onChange={(value) => edit({ counters_enabled: value })}
            disabled={readOnly}
          />
        </section>

        <section className="card space-y-4 p-5" aria-labelledby="autoclose-heading">
          <div>
            <h2 id="autoclose-heading" className="text-lg">
              Auto-close
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Working days after which an open transaction is closed automatically, by service classification. {AUTO_CLOSE_RULE}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {AUTO_CLOSE_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label className="label" htmlFor={key}>
                  {label}
                </label>
                <input
                  id={key}
                  className="input"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Off"
                  value={form[key]}
                  onChange={(e) => edit({ [key]: e.target.value })}
                  readOnly={readOnly}
                  aria-invalid={fieldErrors[key] ? true : undefined}
                  aria-describedby={fieldErrors[key] ? `${key}-error` : undefined}
                />
                {fieldErrors[key] ? (
                  <p id={`${key}-error`} className="mt-1 text-xs text-red-700">
                    {fieldErrors[key]}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        {canWrite ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            <button type="button" className="btn-secondary" disabled={!dirty || saving} onClick={() => { setForm(settingsToForm(settings)); setFieldErrors({}); }}>
              Discard changes
            </button>
            {dirty ? <span className="text-sm text-slate-500">You have unsaved changes.</span> : null}
          </div>
        ) : null}
      </form>

      {showCounters(settings, user.role) ? (
        <Counters user={user} canWrite={canWrite} />
      ) : canWrite && !settings.counters_enabled ? (
        <p className="text-sm text-slate-500">Turn on Counters Enabled and save to manage counters.</p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Save transaction settings?"
        message="The new settings apply from now on. The change is recorded in the audit log."
        confirmLabel="Save settings"
        busy={saving}
        busyLabel="Saving…"
        onConfirm={confirmSave}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

export default function TransactionSettingsPage() {
  return (
    <AppShell
      title="Transaction settings"
      subtitle="How transactions behave: hold, counters and automatic closing."
      breadcrumb={[{ label: 'Transactions', href: '/transactions' }, { label: 'Transaction Settings' }]}
    >
      {(user) => <SettingsManager user={user} />}
    </AppShell>
  );
}
