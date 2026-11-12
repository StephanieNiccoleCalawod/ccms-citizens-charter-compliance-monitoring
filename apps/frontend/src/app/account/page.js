'use client';

import { useEffect, useState } from 'react';
import { ROLE_LIST } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import AccountDetails from '../../components/account/AccountDetails.js';
import ChangePasswordForm from '../../components/account/ChangePasswordForm.js';
import WhatICanDo from '../../components/account/WhatICanDo.js';
import { getMe, getOfficeName } from '../../lib/api/account.js';

function MyAccount() {
  const [me, setMe] = useState(null);
  const [officeName, setOfficeName] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then(async (data) => {
        if (cancelled) return;
        setMe(data);
        if (data.account.office_id) {
          const name = await getOfficeName(data.account.office_id).catch(() => '');
          if (!cancelled) setOfficeName(name || 'Your office');
        }
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!me) return <p className="text-sm text-slate-500">Loading your account…</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-6 lg:col-span-2" aria-labelledby="acct-details">
        <h2 id="acct-details" className="mb-4 text-lg">Account details</h2>
        <AccountDetails account={me.account} officeName={officeName} />
        <p className="mt-4 text-xs text-slate-500">To change your name, email, role or office, ask your Super Admin.</p>
      </section>
      <section className="card p-6" aria-labelledby="acct-password">
        <h2 id="acct-password" className="mb-4 text-lg">Change password</h2>
        <ChangePasswordForm />
      </section>
      <section className="card p-6" aria-labelledby="acct-can-do">
        <h2 id="acct-can-do" className="mb-4 text-lg">What I can do</h2>
        <WhatICanDo items={me.what_i_can_do} />
      </section>
    </div>
  );
}

export default function AccountPage() {
  return (
    <AppShell title="My account" subtitle="Your details, your password and what your role can do." allowedRoles={ROLE_LIST}>
      <MyAccount />
    </AppShell>
  );
}
