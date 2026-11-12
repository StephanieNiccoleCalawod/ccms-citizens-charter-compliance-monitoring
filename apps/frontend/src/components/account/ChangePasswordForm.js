'use client';

import { useState } from 'react';
import PasswordField from '../forms/PasswordField.js';
import SubmitButton from '../ui/SubmitButton.js';
import { FieldError, RequiredMark } from '../forms/Field.js';
import StatusBanner from '../feedback/StatusBanner.js';
import { changeMyPassword } from '../../lib/api/account.js';
import { passwordFormErrors, passwordServerErrors } from '../../lib/ui/account.js';
import { notify } from '../../lib/ui/notify.js';

/** My account > Change password. Nothing is shown as saved until the server says so; the passwords are cleared afterwards. */
export default function ChangePasswordForm({ save = changeMyPassword }) {
  const [values, setValues] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (value) => setValues((v) => ({ ...v, [key]: value }));

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const found = passwordFormErrors(values);
    setErrors(found);
    setBanner(null);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await save({ current: values.current, next: values.next });
      setValues({ current: '', next: '', confirm: '' });
      notify.success('Password changed. Your other sessions have been signed out.');
    } catch (err) {
      const fields = passwordServerErrors(err.details);
      if (Object.keys(fields).length) setErrors(fields);
      else setBanner(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Change password">
      {banner ? <StatusBanner variant="error" message={banner} /> : null}
      <div>
        <label className="label" htmlFor="current-password">
          Current password
          <RequiredMark />
        </label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          className="input"
          value={values.current}
          onChange={(e) => set('current')(e.target.value)}
          aria-required="true"
          aria-invalid={errors.current ? true : undefined}
          aria-describedby={errors.current ? 'current-password-error' : undefined}
        />
        <FieldError id="current-password-error">{errors.current}</FieldError>
      </div>
      <PasswordField id="new-password" label="New password" value={values.next} onChange={set('next')} error={errors.next ?? null} />
      <div>
        <label className="label" htmlFor="confirm-password">
          Confirm new password
          <RequiredMark />
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          className="input"
          value={values.confirm}
          onChange={(e) => set('confirm')(e.target.value)}
          aria-required="true"
          aria-invalid={errors.confirm ? true : undefined}
          aria-describedby={errors.confirm ? 'confirm-password-error' : undefined}
        />
        <FieldError id="confirm-password-error">{errors.confirm}</FieldError>
      </div>
      <SubmitButton busy={busy} label="Change password" busyLabel="Changing…" />
    </form>
  );
}
