'use client';

import { useState } from 'react';
import AppShell from '../../components/layout/AppShell.js';
import LateRiskSection from '../../components/analytics/LateRiskSection.js';
import ScoringModelInfo from '../../components/analytics/ScoringModelInfo.js';
import { TRANSACTION_PAGE_ROLES } from '../../lib/auth/permissions.js';

export default function LateRiskPage() {
  const [info, setInfo] = useState({ model: null, calculation: null });
  return (
    <AppShell
      title="Chance of finishing late"
      subtitle="Open transactions ranked by how likely they are to miss their deadline."
      allowedRoles={TRANSACTION_PAGE_ROLES}
      headerRight={<ScoringModelInfo model={info.model} calculation={info.calculation} />}
    >
      {(user) => <LateRiskSection key={user.id} user={user} onInfoChange={setInfo} />}
    </AppShell>
  );
}
