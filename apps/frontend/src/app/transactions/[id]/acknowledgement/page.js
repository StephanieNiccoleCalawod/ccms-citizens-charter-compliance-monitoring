'use client';

import { useParams } from 'next/navigation';
import { TRANSACTION_OPERATOR_ROLES } from '../../../../lib/auth/permissions.js';
import AppShell from '../../../../components/layout/AppShell.js';
import AcknowledgementSlip from '../../../../components/transactions/AcknowledgementSlip.js';

// CC049: /transactions/:id/acknowledgement — the printable slip. Operators only: it names the officer, so the Executive's
// read-only transaction access (CC027 / K14) does not include it (and the Executive view from the service has no officer fields).
// The server decides access to the transaction itself.
export default function AcknowledgementPage() {
  const { id } = useParams();
  return (
    <AppShell title="Acknowledgement" subtitle="Print and give it to the client." allowedRoles={TRANSACTION_OPERATOR_ROLES}>
      {() => <AcknowledgementSlip key={id} id={id} />}
    </AppShell>
  );
}
