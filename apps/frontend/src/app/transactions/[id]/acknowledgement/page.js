'use client';

import { useParams } from 'next/navigation';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../../../components/layout/AppShell.js';
import AcknowledgementSlip from '../../../../components/transactions/AcknowledgementSlip.js';

// CC049: /transactions/:id/acknowledgement — the printable slip. Same roles as the transaction detail; the server
// decides access to the transaction itself.
export default function AcknowledgementPage() {
  const { id } = useParams();
  return (
    <AppShell title="Acknowledgement" subtitle="Print and give it to the client." allowedRoles={[ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]}>
      {() => <AcknowledgementSlip key={id} id={id} />}
    </AppShell>
  );
}
