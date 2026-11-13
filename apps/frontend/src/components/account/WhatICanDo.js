import StatusBadge from '../ui/StatusBadge.js';
import { groupRows, hasAccess } from '../../lib/ui/account.js';

/** A short, muted note on an allowed-but-restricted row (e.g. "own office"); plain "yes" rows get none. */
function qualifier(item) {
  if (item.switch_key) return item.switch_on ? 'while the Super Admin keeps this on' : null;
  if (item.access === 'own office' || item.access === 'own records') return item.access;
  if (item.access === 'read only') return 'read only';
  return null;
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <path d="m6.5 10.2 2.4 2.4 4.6-5" />
    </svg>
  );
}

function DeniedIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="10" cy="10" r="8" />
    </svg>
  );
}

/** My account > What I can do: the same rule table as the Roles and permissions matrix, for the signed-in role only, read-only. */
export default function WhatICanDo({ items }) {
  const groups = groupRows(items);
  const allowedCount = (items ?? []).filter((item) => hasAccess(item.access)).length;
  const total = (items ?? []).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="title-card">What I can do</h2>
        <StatusBadge variant={allowedCount === total ? 'success' : 'neutral'}>{allowedCount} of {total} allowed</StatusBadge>
      </div>
      <div className="columns-1 gap-x-8 lg:columns-2">
        {groups.map((group) => (
          <section key={group.name} className="mb-5 break-inside-avoid-column" aria-labelledby={`wicd-${group.name}`}>
            <h3 id={`wicd-${group.name}`} className="text-xs font-bold uppercase tracking-wide text-maroon-800">
              {group.name}
            </h3>
            <ul className="mt-2 divide-y divide-line">
              {group.rows.map((item) => {
                const allowed = hasAccess(item.access);
                const note = allowed ? qualifier(item) : null;
                return (
                  <li key={item.key} className="flex items-start gap-2.5 py-2 text-sm">
                    {allowed ? <CheckIcon /> : <DeniedIcon />}
                    <span className={allowed ? 'text-slate-800' : 'text-slate-400'}>
                      {item.label}
                      {note ? <span className="text-slate-400"> ({note})</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
