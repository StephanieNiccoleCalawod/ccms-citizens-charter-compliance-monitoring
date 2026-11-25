'use client';

import { useEffect, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import ErrorBanner from '../../../components/feedback/ErrorBanner.js';
import AppShell from '../../../components/layout/AppShell.js';
import LoadingState from '../../../components/ui/LoadingState.js';
import TableShell, { Table, Th } from '../../../components/ui/TableShell.js';
import { getSessionPolicy } from '../../../lib/api/account.js';
import { SESSION_POLICY_OFF_NOTE, formatLimit } from '../../../lib/ui/account.js';

// S8-34: the sign-in limits the server enforces for each role, read-only. The values come from Identity, never from this page.
function SecurityAndSessions() {
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getSessionPolicy()
      .then((data) => !cancelled && setPolicy(data))
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!policy) return <LoadingState>Loading sign-in limits…</LoadingState>;
  return (
    <section className="card p-6" aria-labelledby="sess-heading">
      <h2 id="sess-heading" className="title-card">Sign-in limits by role</h2>
      <p className="mt-1 text-sm text-slate-600">
        A person is signed out after the idle time with no activity, or after the total time since they signed in, whichever comes first.
        A warning appears 60 seconds before the idle limit.
      </p>
      {policy.enforced ? null : <p className="mt-3 rounded-control bg-surface-muted px-4 py-3 text-sm text-slate-600" data-testid="session-policy-off">{SESSION_POLICY_OFF_NOTE}</p>}
      <div className="mt-4">
        <TableShell>
          <Table
            label="Sign-in limits by role"
            head={
              <tr>
                <Th>Role</Th>
                <Th>Idle limit</Th>
                <Th>Total time</Th>
              </tr>
            }
          >
            {policy.roles.map((row) => (
              <tr key={row.role} className="tr-row">
                <td className="td font-semibold text-slate-900">{row.role_label}</td>
                <td className="td">{formatLimit(row.idle_minutes)}</td>
                <td className="td">{formatLimit(row.absolute_minutes)}</td>
              </tr>
            ))}
          </Table>
        </TableShell>
      </div>
      <p className="mt-4 text-xs text-slate-500">{policy.applies_to} These limits cannot be changed from this page.</p>
    </section>
  );
}

export default function SecurityAndSessionsPage() {
  return (
    <AppShell title="Security and sessions" subtitle="How long each role can stay signed in." allowedRoles={[ROLES.SUPER_ADMIN]}>
      <SecurityAndSessions />
    </AppShell>
  );
}
