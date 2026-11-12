import { lastSignIn } from '../../lib/ui/account.js';

/** My account: the person's own details, read-only. `officeName` is looked up by the page (the account only holds the office id). */
export default function AccountDetails({ account, officeName }) {
  const rows = [
    ['Name', account.full_name],
    ['Email', account.email],
    ['Employee number', account.employee_no],
    ['Role', account.role_label],
    ['Office', account.office_id ? officeName || 'Loading…' : 'All offices'],
    ['Position', account.position || '—'],
    ['Last sign-in', lastSignIn(account.last_login_at)],
  ];
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
