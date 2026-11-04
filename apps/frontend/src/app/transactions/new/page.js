'use client';

import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../../components/layout/AppShell.js';
import StartTransactionForm from '../../../components/transactions/StartTransactionForm.js';

export default function StartTransactionPage() {
  return (
    <AppShell
      title="Start transaction"
      subtitle="Record a new service transaction. The standard in force today is saved with it."
      breadcrumb={[{ label: 'Transactions', href: '/transactions' }, { label: 'Add Transaction' }]}
      allowedRoles={[ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]}
    >
      {(user) => <StartTransactionForm user={user} />}
    </AppShell>
  );
}
