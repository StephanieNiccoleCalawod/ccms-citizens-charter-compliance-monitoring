import RoleBadge from '../ui/RoleBadge.js';
import { initials, lastSignIn } from '../../lib/ui/account.js';

/** My account: the person's own details, read-only. `officeName` is looked up by the page (the account only holds the office id). */
export default function AccountDetails({ account, officeName }) {
  const rows = [
    ['Employee number', account.employee_no],
    ['Office', account.office_id ? officeName || 'Loading…' : 'All offices'],
    ['Position', account.position || '—'],
    ['Last sign-in', lastSignIn(account.last_login_at)],
  ];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-maroon-950 text-lg font-bold text-white" aria-hidden="true">
          {initials(account.full_name)}
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-slate-900">{account.full_name}</span>
            <RoleBadge role={account.role} />
          </p>
          <p className="truncate text-sm text-slate-600">{account.email}</p>
        </div>
      </div>

      <dl className="mt-6 grid gap-x-8 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className="mt-0.5 break-words text-sm text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-5 rounded-control bg-surface-muted px-4 py-3 text-sm text-slate-600">
        To change your name, email, role or office, ask your Super Admin.
      </p>
    </div>
  );
}
