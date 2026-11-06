'use client';

import { OFFICE_CODE_MAX, composeOfficeCode } from '../../lib/ui/office-code.js';
import { RequiredMark } from './Field.js';

/**
 * The Office code input of the Add and Edit Office form: the institution code as fixed text ("PUP-") joined to an input for the
 * office part ("OSAS"), and the full code that will result underneath ("PUP-OSAS"). Core builds the real code from the part, so
 * this is a preview. `value` is the office part. `currentCode` (Edit, when the saved code does not start with the institution
 * code yet) is shown as a note, because that office has no separate part to fill in.
 */
export default function OfficeCodeField({ id = 'office_code', prefix, value, onChange, error, currentCode = null, autoFocus = false }) {
  const maxLength = Math.max(1, OFFICE_CODE_MAX - prefix.length - 1);
  const errorId = `${id}-error`;
  const fullId = `${id}-full`;
  return (
    <div>
      <label className="label" htmlFor={id}>
        Office code
        <RequiredMark />
      </label>
      <div className="flex items-stretch">
        <span className="inline-flex shrink-0 items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-100 px-3 text-sm font-semibold text-slate-700" data-testid="office-code-prefix" aria-label={`Institution code ${prefix}, fixed`}>
          {prefix}-
        </span>
        <input
          id={id}
          className="input min-w-0 rounded-l-none uppercase"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          maxLength={maxLength}
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder="e.g. OSAS"
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${fullId}` : fullId}
        />
      </div>
      <p id={fullId} className="mt-1 text-xs text-slate-500" aria-live="polite">
        Full office code: <span className="font-semibold text-slate-700" data-testid="office-code-preview">{composeOfficeCode(prefix, value) || `${prefix}-`}</span>
      </p>
      {currentCode ? (
        <p className="mt-1 text-xs text-slate-500">
          This office is saved as <span className="font-semibold text-slate-700">{currentCode}</span>, which does not start with {prefix}. Enter the office part to give it a full code.
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
