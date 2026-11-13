'use client';

import { useEffect, useRef, useState } from 'react';
import { searchRegistry } from '../../lib/api/registry.js';
import { formatDate } from '../../lib/ui/date-format.js';
import { REGISTRY_NOTE_MAX, REGISTRY_REASONS, isSearchable, registryNeedsReason } from '../../lib/ui/start-transaction.js';

const FieldError = ({ id, children }) => (children ? <p id={id} className="mt-1 text-xs text-red-700">{children}</p> : null);
const SEARCH_DELAY_MS = 350;

/**
 * CC044: find a Student or Alumni client in the registry at Start, or continue with "Not in the registry" and a reason.
 * Never blocks a Start (K5). The server re-checks the pick against the current registry; this only helps choose.
 *  - clientType: STUDENT or ALUMNI (the search is limited to enrolled students or alumni accordingly).
 *  - value / onChange: { choice: 'none' | 'match' | 'not_found', record, reason, note } (lib/ui/start-transaction.js).
 * Out-of-order answers are ignored (only the latest request may update the list). An expired record is shown as
 * expired and is never treated as a valid match: picking it asks for a reason, like "Not in the registry".
 * The parent gives it a `key` made of the service and the client type, so a change of either mounts a fresh picker
 * (empty search, no results) without resetting state from an effect; answers to the old picker are dropped.
 */
export default function RegistryPicker({ clientType, value, onChange, errors = {}, disabled = false }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ status: 'idle', items: [], message: null }); // idle | loading | ready | failed
  const latest = useRef(0);
  const timer = useRef(null);

  // On unmount (a new service or client type): cancel the pending search and drop any answer still on its way.
  useEffect(() => {
    const requests = latest;
    const pending = timer;
    return () => {
      clearTimeout(pending.current);
      requests.current += 1;
    };
  }, []);

  function runSearch(text) {
    clearTimeout(timer.current);
    const request = ++latest.current;
    if (!isSearchable(text)) {
      setState({ status: 'idle', items: [], message: null });
      return;
    }
    setState((s) => ({ ...s, status: 'loading', message: null }));
    timer.current = setTimeout(async () => {
      try {
        const data = await searchRegistry(text.trim(), clientType);
        if (request === latest.current) setState({ status: 'ready', items: data.items ?? [], message: null });
      } catch (err) {
        if (request !== latest.current) return;
        const message = err?.status === 429
          ? 'Too many searches in a minute. Wait a moment, or continue with "Not in the registry".'
          : 'The registry search is not available right now. You can continue with "Not in the registry".';
        setState({ status: 'failed', items: [], message });
      }
    }, SEARCH_DELAY_MS);
  }

  const choose = (patch) => onChange({ ...value, ...patch });
  const pick = (record) => choose({ choice: 'match', record, reason: '', note: '' });
  const label = clientType === 'ALUMNI' ? 'alumni' : 'enrolled students';
  const needsReason = registryNeedsReason(value);

  return (
    <fieldset className="space-y-3" id="start-registry" tabIndex={-1} aria-describedby={errors.registry ? 'start-registry-error' : undefined}>
      <legend className="label">Registry check<span className="ml-1 text-xs font-normal text-slate-500">(searches {label})</span></legend>

      {value.choice === 'match' && value.record ? (
        <div className="rounded-lg border border-line bg-slate-50 p-3 text-sm" data-testid="registry-selected">
          <p className="font-semibold text-slate-900">{value.record.full_name}</p>
          <p className="text-slate-700">
            <span className="font-mono">{value.record.student_number}</span> · {value.record.program}
            {value.record.year_level ? ` · Year ${value.record.year_level}` : ''}
          </p>
          {value.record.is_expired ? (
            <p className="mt-1 text-xs font-semibold text-amber-800">Registry record expired{value.record.valid_until ? ` on ${formatDate(value.record.valid_until)}` : ''}. Choose a reason below to continue.</p>
          ) : (
            <p className="mt-1 text-xs text-emerald-800">Valid registry record{value.record.valid_until ? ` until ${formatDate(value.record.valid_until)}` : ''}.</p>
          )}
          <button type="button" className="btn-secondary mt-2" onClick={() => choose({ choice: 'none', record: null, reason: '', note: '' })} disabled={disabled}>
            Choose someone else
          </button>
        </div>
      ) : null}

      {value.choice !== 'match' ? (
        <div>
          <label className="sr-only" htmlFor="start-registry-search">Search the registry by student number or name</label>
          <input
            id="start-registry-search"
            type="search"
            className="input"
            placeholder="Student number, or at least 3 letters of the name"
            value={query}
            maxLength={100}
            autoComplete="off"
            disabled={disabled || value.choice === 'not_found'}
            onChange={(e) => {
              setQuery(e.target.value);
              runSearch(e.target.value);
            }}
          />
          <div aria-live="polite" className="mt-2 text-sm">
            {state.status === 'loading' ? <p className="text-slate-500">Searching…</p> : null}
            {state.status === 'failed' ? <p className="text-amber-800">{state.message}</p> : null}
            {state.status === 'ready' && state.items.length === 0 ? <p className="text-slate-600">No match. If the client is not in the registry, choose &quot;Not in the registry&quot; below.</p> : null}
          </div>
          {state.status === 'ready' && state.items.length > 0 && value.choice !== 'not_found' ? (
            <ul className="mt-1 divide-y divide-line rounded-lg border border-line" data-testid="registry-results">
              {state.items.map((item) => (
                <li key={item.student_number}>
                  <button type="button" className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => pick(item)} disabled={disabled}>
                    <span>
                      <span className="block font-medium text-slate-900">{item.full_name}</span>
                      <span className="block text-xs text-slate-600"><span className="font-mono">{item.student_number}</span> · {item.program}{item.year_level ? ` · Year ${item.year_level}` : ''}</span>
                    </span>
                    {item.is_expired ? <span className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Expired</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {value.choice !== 'match' ? (
        <label className="flex items-start gap-3 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-pup-maroon"
            checked={value.choice === 'not_found'}
            disabled={disabled}
            onChange={(e) => choose(e.target.checked ? { choice: 'not_found', record: null } : { choice: 'none', reason: '', note: '' })}
          />
          <span>
            Not in the registry
            <span className="block text-xs text-slate-500">The transaction still starts. It is flagged &quot;not in registry&quot; with the reason you choose.</span>
          </span>
        </label>
      ) : null}
      <FieldError id="start-registry-error">{errors.registry}</FieldError>

      {needsReason ? (
        <div className="grid gap-3">
          <div>
            <label className="label" htmlFor="start-registry-reason">Reason</label>
            <select id="start-registry-reason" className="input select-chevron" value={value.reason} disabled={disabled}
              onChange={(e) => choose({ reason: e.target.value })}
              aria-invalid={errors.registry_miss_reason ? true : undefined} aria-describedby={errors.registry_miss_reason ? 'start-registry-reason-error' : undefined}>
              <option value="">Select a reason</option>
              {REGISTRY_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <FieldError id="start-registry-reason-error">{errors.registry_miss_reason}</FieldError>
          </div>
          <div>
            <label className="label" htmlFor="start-registry-note">Note {value.reason === 'OTHER' ? '' : '(optional)'}</label>
            <input id="start-registry-note" className="input" value={value.note} maxLength={REGISTRY_NOTE_MAX} disabled={disabled}
              onChange={(e) => choose({ note: e.target.value })}
              aria-invalid={errors.registry_miss_note ? true : undefined} aria-describedby={errors.registry_miss_note ? 'start-registry-note-error' : undefined} />
            <p className="mt-1 text-xs text-slate-500">Visible to staff on the transaction only. {value.note.length} / {REGISTRY_NOTE_MAX}</p>
            <FieldError id="start-registry-note-error">{errors.registry_miss_note}</FieldError>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
