'use client';

import { useState } from 'react';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import StatusBanner from '../feedback/StatusBanner.js';
import Switch from '../ui/Switch.js';
import { CATALOGUE_SETTINGS_API } from '../../lib/api/catalogue.js';
import { settingsErrorMessage } from '../../lib/api/calendar.js';
import { apiFetch } from '../../lib/auth/session.js';
import { useSingleSubmit } from '../../lib/ui/useSingleSubmit.js';

/**
 * The "class and office suspensions" setting (applies_to_enabled) of the Calendar, for the Super Admin only (the page that
 * renders this passes it only to them; Core answers 403 to anyone else). The value comes from Core and is saved to Core with
 * PUT /api/catalogue/catalogue-settings { applies_to_enabled }; after a save the panel shows what Core returned, not what was
 * asked for. Nothing is kept in the browser. `settings` is { loading, enabled, error }; `onSaved(enabled)` hands Core's value back.
 */
export default function AppliesToSetting({ settings, onRetry, onSaved }) {
  const [asking, setAsking] = useState(null); // the value being asked about
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const once = useSingleSubmit();

  function confirm() {
    const target = asking;
    return once(async () => {
      setAsking(null);
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const data = await apiFetch(CATALOGUE_SETTINGS_API, { method: 'PUT', body: { applies_to_enabled: target } });
        const saved = data?.settings?.applies_to_enabled;
        onSaved(saved === true);
        setNotice(saved === true ? 'Class and office suspensions are on.' : 'Class and office suspensions are off.');
      } catch (err) {
        setError(settingsErrorMessage(err)); // the switch stays where Core has it; no success message
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="applies-to-heading" data-testid="applies-to-setting">
      <h3 id="applies-to-heading" className="text-lg font-bold">Class suspensions</h3>
      {settings.loading ? (
        <p className="mt-2 text-sm text-slate-500" role="status">Loading the setting…</p>
      ) : settings.error ? (
        <div className="mt-3 space-y-3">
          <ErrorBanner message={settings.error} />
          <button type="button" className="btn-secondary" onClick={onRetry}>Try again</button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <Switch
            label="Class and office suspensions"
            description="When on, each calendar entry can apply to offices and classes, to classes only, or to offices only, and classes can be marked as no classes or online. When off, every entry applies to offices and classes."
            checked={settings.enabled === true}
            onChange={(value) => setAsking(value)}
            disabled={saving}
          />
          {saving ? <p className="text-sm text-slate-500" role="status">Saving…</p> : null}
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
          {notice ? <StatusBanner variant="success" message={notice} onDismiss={() => setNotice(null)} /> : null}
        </div>
      )}
      <ConfirmDialog
        open={asking !== null}
        title={asking ? 'Turn on class and office suspensions?' : 'Turn off class and office suspensions?'}
        message={
          asking
            ? 'Calendar entries will be able to apply to offices, classes or both. Office working time and deadlines are not affected by the class setting.'
            : 'Every entry will apply to offices and classes again. This is refused while any entry is set to classes only, offices only or online classes: change those entries first.'
        }
        confirmLabel={asking ? 'Turn on' : 'Turn off'}
        onConfirm={confirm}
        onCancel={() => setAsking(null)}
      />
    </section>
  );
}
