'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ROLES } from 'ccms-shared/roles';
import AccountShell from '../../../components/layout/AccountShell.js';
import InstitutionCodePanel from '../../../components/offices/InstitutionCodePanel.js';
import LoadingState from '../../../components/ui/LoadingState.js';
import { CATALOGUE_SETTINGS_API } from '../../../lib/api/catalogue.js';
import { apiFetch } from '../../../lib/auth/session.js';

export function InstitutionCodeSettings() {
  const [state, setState] = useState({ loading: true, code: null, error: null });

  useEffect(() => {
    let cancelled = false;
    apiFetch(CATALOGUE_SETTINGS_API)
      .then((data) => !cancelled && setState({ loading: false, code: data?.settings?.institution_code ?? null, error: null }))
      .catch((err) => !cancelled && setState({ loading: false, code: null, error: err?.message || 'Could not load the institution code.' }));
    return () => {
      cancelled = true;
    };
  }, []);

  async function retry() {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await apiFetch(CATALOGUE_SETTINGS_API);
      setState({ loading: false, code: data?.settings?.institution_code ?? null, error: null });
    } catch (err) {
      setState({ loading: false, code: null, error: err?.message || 'Could not load the institution code.' });
    }
  }

  if (state.loading) return <LoadingState>Loading institution code…</LoadingState>;

  if (!state.code) {
    return (
      <InstitutionCodePanel
        settings={state}
        onRetry={retry}
        onSaved={(code) => setState({ loading: false, code, error: null })}
      />
    );
  }

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="institution-code-heading" data-testid="settings-section-institution-code">
      <h2 id="institution-code-heading" className="title-card">Institution code</h2>
      <p className="mt-1 text-sm text-slate-600">
        The fixed prefix of every office code (for example PUP-OSAS). Manage offices themselves from the{' '}
        <Link href="/offices" className="font-medium text-maroon-700 underline-offset-2 hover:underline">
          Offices
        </Link>{' '}
        page.
      </p>
      <p className="mt-4 text-sm text-slate-700" data-testid="institution-code-status">
        Institution code: <span className="font-mono font-semibold text-slate-900">{state.code}</span>
      </p>
    </section>
  );
}

export default function InstitutionCodePage() {
  return (
    <AccountShell
      title="Institution code"
      subtitle="The fixed prefix of every office code (for example PUP-OSAS). Manage offices themselves from the Offices page."
      allowedRoles={[ROLES.SUPER_ADMIN]}
      breadcrumb={[{ label: 'Settings', href: '/settings' }, { label: 'Institution Code' }]}
    >
      <InstitutionCodeSettings />
    </AccountShell>
  );
}
