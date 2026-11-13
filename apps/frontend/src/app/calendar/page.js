'use client';

import { useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import Tabs, { tabPanelProps } from '../../components/ui/Tabs.js';
import Holidays from './Holidays.js';
import SyncPanel from './SyncPanel.js';
import Terms from './Terms.js';
import WorkingHoursScope from './WorkingHoursScope.js';

// The page title and description follow the selected tab.
const TABS = [
  { id: 'hours', label: 'Working hours', subtitle: 'The weekly schedule of the campus, and of any office that has its own. CCCMS uses it to compute deadlines (Asia/Manila).' },
  { id: 'holidays', label: 'Holidays & suspensions', subtitle: 'Holidays and suspensions on the campus calendar (Asia/Manila).' },
  { id: 'terms', label: 'Academic terms', subtitle: 'Academic terms are managed in the Syllabus Management System (SMS) and cannot be changed here. They do not change how CCCMS computes deadlines.' },
];

function CalendarManager({ user, tab, setTab }) {
  const canWrite = user.role === ROLES.SUPER_ADMIN;
  const [syncKey, setSyncKey] = useState(0);
  const changed = () => setSyncKey((k) => k + 1);

  return (
    <div className="space-y-4">
      <Tabs label="Calendar sections" idPrefix="calendar" tabs={TABS} value={tab} onChange={setTab} />
      <div {...tabPanelProps('calendar', tab)} className="focus:outline-none">
        {tab === 'hours' ? <WorkingHoursScope user={user} canWrite={canWrite} onChanged={changed} /> : null}
        {tab === 'holidays' ? <Holidays canWrite={canWrite} onChanged={changed} /> : null}
        {tab === 'terms' ? <Terms /> : null}
      </div>
      {canWrite ? <SyncPanel refreshKey={syncKey} /> : null}
    </div>
  );
}

export default function CalendarPage() {
  const [tab, setTab] = useState('hours');
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <AppShell
      title={active.label}
      subtitle={active.subtitle}
      eyebrow={<span className="text-xs font-bold uppercase tracking-wider text-slate-500">Calendar</span>}
    >
      {(user) => <CalendarManager user={user} tab={tab} setTab={setTab} />}
    </AppShell>
  );
}
