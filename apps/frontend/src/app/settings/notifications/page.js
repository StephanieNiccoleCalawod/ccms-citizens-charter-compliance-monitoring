'use client';

import AccountShell from '../../../components/layout/AccountShell.js';
import NotificationCenter from '../../../components/notifications/NotificationCenter.js';
import { BELL_ROLES } from '../../../lib/ui/notifications.js';

// Settings > Notification Center: the full list behind the bell. Same notices, same read marks; the bell's "Open Full Notification Center" opens it.
export default function NotificationCenterPage() {
  return (
    <AccountShell title="Notification Center" subtitle="Every notice from the bell in one place. Search, filter and mark them as read." allowedRoles={BELL_ROLES}
      breadcrumb={[{ label: 'Settings', href: '/settings' }, { label: 'Notification Center' }]}>
      {() => <NotificationCenter />}
    </AccountShell>
  );
}
