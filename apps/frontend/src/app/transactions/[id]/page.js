'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../../components/layout/AppShell.js';
import TransactionDetail from '../../../components/transactions/TransactionDetail.js';
import { backToListHref } from '../../../lib/ui/transaction-list.js';

export default function TransactionDetailPage() {
  const { id } = useParams(); // keyed by the address: opening another transaction never shows the previous one's data
  // The list view this transaction was opened from (carried in the address), so Back returns to the same filters and page.
  const backHref = backToListHref(useSearchParams().get('back') ?? '');
  return (
    <AppShell
      title="Transaction"
      subtitle="Status, standard and time on hold."
      allowedRoles={[ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]}>
      {(user) => <TransactionDetail key={id} id={id} role={user.role} backHref={backHref} />}
    </AppShell>
  );
}
