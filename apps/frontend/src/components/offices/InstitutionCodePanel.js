'use client';

import { useState } from 'react';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import { FieldError, RequiredMark } from '../forms/Field.js';
import { CATALOGUE_SETTINGS_API } from '../../lib/api/catalogue.js';
import { apiFetch } from '../../lib/auth/session.js';
import { institutionCodeProblem, institutionSaveError } from '../../lib/ui/office-code.js';
import { useSingleSubmit } from '../../lib/ui/useSingleSubmit.js';

/**
 * The institution code (CC006) on the Offices page, which only a Super Admin can open. Core keeps one institution code: it can be
 * set once and the server then refuses every change. Until there is a code, a Super Admin can enter it here, after a confirmation
 * that says it cannot be changed afterwards. As soon as Core has a code this panel is gone (the code is the fixed prefix in the
 * office form). Nothing is stored in the browser: the code is read from and saved to Core (GET and PUT /api/catalogue/catalogue-settings),
 * and a code that cannot be loaded is reported, never guessed.
 *
 * `settings` is { loading, code, error }; `onSaved(code)` tells the page the code Core now holds.
 */
export default function InstitutionCodePanel({ settings, onRetry, onSaved }) {
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [message, setMessage] = useState(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const once = useSingleSubmit();

  function ask(event) {
    event.preventDefault();
    const code = value.trim();
    const problem = institutionCodeProblem(code);
    setMessage(null);
    if (problem) {
      setFieldError(problem);
      return;
    }
    setFieldError(null);
    setAsking(true);
  }

  function confirm() {
    return once(async () => {
      setAsking(false);
      setSaving(true);
      setMessage(null);
      try {
        const data = await apiFetch(CATALOGUE_SETTINGS_API, { method: 'PUT', body: { institution_code: value.trim() } });
        onSaved(data?.settings?.institution_code ?? null);
      } catch (err) {
        const { fieldErrors, message: banner } = institutionSaveError(err);
        setFieldError(fieldErrors.institution_code ?? null); // what was typed stays in the box
        setMessage(banner);
      } finally {
        setSaving(false);
      }
    });
  }

  // Once the institution code is set there is nothing left to do here, so the panel is gone (the code is the fixed prefix in the office
  // form). It also stays out of the way while the code is loading.
  if (settings.loading || settings.code) return null;

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="institution-heading" data-testid="institution-panel">
      <h2 id="institution-heading" className="text-lg">Institution code</h2>
      {settings.error ? (
        <div className="mt-3 space-y-3">
          <ErrorBanner message={settings.error} />
          <button type="button" className="btn-secondary" onClick={onRetry}>Try again</button>
        </div>
      ) : (
        <form onSubmit={ask} noValidate className="mt-3">
          <p className="text-sm text-slate-600">
            The institution code has not been set yet. Set it before adding offices: it becomes the first part of every office code, for example <span className="font-semibold">PUP-OSAS</span>.
          </p>
          <ErrorBanner message={message} />
          <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="w-full sm:w-56">
              <label className="label" htmlFor="institution_code">
                Institution code
                <RequiredMark />
              </label>
              <input
                id="institution_code"
                className="input uppercase"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value.toUpperCase());
                  setFieldError(null);
                }}
                maxLength={10}
                placeholder="e.g. PUP"
                autoComplete="off"
                aria-required="true"
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? 'institution_code-error' : 'institution_code-hint'}
              />
              <p id="institution_code-hint" className="mt-1 text-xs text-slate-500">2 to 10 uppercase letters or digits.</p>
              <FieldError id="institution_code-error">{fieldError}</FieldError>
            </div>
            <button type="submit" className="btn-primary sm:mt-[21px]" disabled={saving}>
              {saving ? 'Saving…' : 'Save institution code'}
            </button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={asking}
        title="Set the institution code?"
        message={`The institution code will be ${value.trim()}. It becomes the first part of every office code (for example ${value.trim()}-OSAS) and cannot be changed afterwards.`}
        confirmLabel="Set institution code"
        onConfirm={confirm}
        onCancel={() => setAsking(false)}
      />
    </section>
  );
}

