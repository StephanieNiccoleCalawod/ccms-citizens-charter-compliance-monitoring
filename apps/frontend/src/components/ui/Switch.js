'use client';

import { useId } from 'react';

/**
 * An on/off switch with a visible label and optional help text. role="switch" so assistive technology
 * announces it as on or off. When read-only it stays visible (and announced) but cannot be changed.
 */
export default function Switch({ checked, onChange, label, description, disabled = false }) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-semibold text-slate-900">
          {label}
        </p>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-sm text-slate-500">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${checked ? 'bg-maroon-800' : 'bg-slate-300'}`}
      >
        <span aria-hidden="true" className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}
