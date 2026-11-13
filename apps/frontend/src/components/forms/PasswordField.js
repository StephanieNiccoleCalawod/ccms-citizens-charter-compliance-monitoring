'use client';

import { useId, useState } from 'react';
import { RequiredMark } from './Field.js';
import { PASSWORD_REQUIREMENTS, passwordStatus, passwordStrengthMeter } from '../../lib/ui/password-guidance.js';

function EyeIcon({ off }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

/**
 * A new password with an eye / eye-off button (it only changes the input type, never the value), the requirements under it,
 * and a live message while typing. `error` is a message from the server for this field.
 */
export default function PasswordField({ id = 'password', label = 'Initial password', value, onChange, error = null, required = true, helper = null }) {
  const [visible, setVisible] = useState(false);
  const [touched, setTouched] = useState(false);
  const uid = useId();
  const hintId = `${uid}-requirements`;
  const statusId = `${uid}-status`;
  const status = passwordStatus(value);
  const showStatus = status.level !== 'empty' && (touched || status.level !== 'error');
  const invalid = Boolean(error) || (status.level === 'error' && touched);
  const message = error || (showStatus ? status.message : '');
  const tone = error || status.level === 'error' ? 'text-red-700' : status.level === 'good' ? 'text-green-700' : 'text-amber-800';
  const meter = passwordStrengthMeter(status.level);

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
        {required ? <RequiredMark /> : null}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          className="input pr-11"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          required={required}
          aria-required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={`${hintId} ${statusId}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700"
        >
          <EyeIcon off={visible} />
        </button>
      </div>
      <div aria-hidden="true" className="mt-2 flex gap-1">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < meter.filled ? meter.tone : 'bg-slate-200'}`} />
        ))}
      </div>
      <p id={statusId} role={invalid ? 'alert' : 'status'} className={`mt-1 min-h-4 text-xs font-medium ${tone}`}>
        {message}
      </p>
      <div id={hintId} className="mt-1 text-xs text-slate-500">
        <p className="font-semibold text-slate-600">Password guidance</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
          {PASSWORD_REQUIREMENTS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {helper ? <p className="mt-1">{helper}</p> : null}
      </div>
    </div>
  );
}
