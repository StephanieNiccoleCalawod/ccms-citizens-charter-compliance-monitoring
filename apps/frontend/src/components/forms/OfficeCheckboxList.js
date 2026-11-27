'use client';

import Checkbox from '../ui/Checkbox.js';

/**
 * Multi-select list of offices using the shared CCMS Checkbox. Bound to `selectedIds` (array of office_id strings).
 * Active offices are always listed; any already-selected inactive office stays visible so it can still be reviewed or unchecked.
 */
export default function OfficeCheckboxList({ offices = [], selectedIds = [], onChange, disabled = false, idPrefix = 'office-scope' }) {
  const selected = new Set((selectedIds ?? []).map((id) => String(id).toLowerCase()));
  const visible = offices.filter((o) => o.is_active !== false || selected.has(String(o.office_id).toLowerCase()));

  function toggle(officeId, checked) {
    const target = String(officeId).toLowerCase();
    const current = [...selected];
    const next = checked
      ? (selected.has(target) ? current : [...current, target])
      : current.filter((id) => id !== target);
    onChange?.(next);
  }

  if (visible.length === 0) {
    return <p className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-xs text-ink-muted">No active offices available.</p>;
  }

  const allSelected = visible.every((o) => selected.has(String(o.office_id).toLowerCase()));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span>{selected.size} of {visible.length} selected</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={disabled || allSelected}
            onClick={() => onChange?.(visible.map((o) => String(o.office_id).toLowerCase()))}
            className="font-medium text-maroon-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
          >
            Select all
          </button>
          <button
            type="button"
            disabled={disabled || selected.size === 0}
            onClick={() => onChange?.([])}
            className="font-medium text-ink-muted hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>
      <div
        role="group"
        aria-label="Select offices"
        className="max-h-52 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-white px-3 py-1"
        data-testid="office-checkbox-list"
      >
        {visible.map((office) => {
          const id = String(office.office_id).toLowerCase();
          return (
            <div key={office.office_id} className="py-2">
              <Checkbox
                id={`${idPrefix}-${office.office_id}`}
                checked={selected.has(id)}
                disabled={disabled}
                onChange={(event) => toggle(office.office_id, event.target.checked)}
                label={office.office_name}
                description={office.is_active === false ? 'Inactive office' : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
