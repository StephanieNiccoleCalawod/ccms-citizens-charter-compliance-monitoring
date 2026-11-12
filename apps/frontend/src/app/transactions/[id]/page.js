'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { TRANSACTION_PAGE_ROLES } from '../../../lib/auth/permissions.js';
import AppShell from '../../../components/layout/AppShell.js';
import TransactionDetail from '../../../components/transactions/TransactionDetail.js';
import { backToListHref } from '../../../lib/ui/transaction-list.js';

export default function TransactionDetailPage() {
  // Keyed by role and address: a change of either never shows the previous transaction's data. Executive is read-only (K14).
  const { id } = useParams();
  // The list view this transaction was opened from (carried in the address), so Back returns to the same filters and page.
  const backHref = backToListHref(useSearchParams().get('back') ?? '');
  return (
    <AppShell
      title="Transaction"
      subtitle="Status, standard and time on hold."
      allowedRoles={TRANSACTION_PAGE_ROLES}>
      {(user) => <TransactionDetail key={`${user.role}:${id}`} id={id} role={user.role} backHref={backHref} />}
    </AppShell>
  );
}
