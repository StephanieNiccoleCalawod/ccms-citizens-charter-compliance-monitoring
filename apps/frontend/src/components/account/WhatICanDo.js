import { groupRows, myAccessLabel } from '../../lib/ui/account.js';

const tone = (item) => (item.switch_key ? (item.switch_on ? 'text-emerald-700' : 'text-amber-800') : item.access === 'no' ? 'text-slate-500' : 'text-slate-900');

/** My account > What I can do: the same rule table as the Roles and permissions matrix, for the signed-in role only. */
export default function WhatICanDo({ items }) {
  const groups = groupRows(items);
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.name} aria-labelledby={`wicd-${group.name}`}>
          <h3 id={`wicd-${group.name}`} className="text-xs font-bold uppercase tracking-wide text-slate-500">
            {group.name}
          </h3>
          <ul className="mt-1 divide-y divide-slate-100">
            {group.rows.map((item) => (
              <li key={item.key} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm">
                <span className="text-slate-800">{item.label}</span>
                <span className={`font-semibold ${tone(item)}`}>{myAccessLabel(item)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
