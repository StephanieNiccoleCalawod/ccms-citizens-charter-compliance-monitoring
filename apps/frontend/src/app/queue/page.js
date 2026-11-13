'use client';

import AppShell from '../../components/layout/AppShell.js';
import QueuePanel from '../../components/queue/QueuePanel.js';
import { QUEUE_PAGE_ROLES } from '../../lib/ui/queue.js';

// CC039 staff queue: Office Head and Office Staff (their office) and Super Admin (any office). Executive has no queue access.
export default function Queue() {
  return (
    <AppShell title="Queue" subtitle="Call the next ticket, skip a no-show, or issue a ticket for a walk-in." allowedRoles={QUEUE_PAGE_ROLES}>
      {(user) => <QueuePanel user={user} />}
    </AppShell>
  );
}
