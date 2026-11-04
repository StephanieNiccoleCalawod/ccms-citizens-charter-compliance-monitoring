'use client';

import { useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import Holidays from './Holidays.js';
import SyncPanel from './SyncPanel.js';
import Terms from './Terms.js';
import WorkingHours from './WorkingHours.js';

// The page title and description follow the selected tab.
const TABS = [
  { id: 'hours', label: 'Working hours', subtitle: 'The weekly schedule of the campus. CCMS uses it to compute deadlines (Asia/Manila).' },
  { id: 'holidays', label: 'Holidays & suspensions', subtitle: 'Holidays and suspensions on the campus calendar (Asia/Manila).' },
  { id: 'terms', label: 'Academic terms', subtitle: 'Academic terms are shared with Audit. They do not change how CCMS computes deadlines.' },
];

function CalendarManager({ user, tab, setTab }) {
  const canWrite = user.role === ROLES.SUPER_ADMIN;
  const [syncKey, setSyncKey] = useState(0);
  const changed = () => setSyncKey((k) => k + 1);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Calendar sections" className="flex flex-wrap gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-4 px-4 py-2 text-sm font-semibold ${tab === t.id ? 'border-gold-500 text-maroon-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'hours' ? <WorkingHours canWrite={canWrite} onChanged={changed} /> : null}
        {tab === 'holidays' ? <Holidays canWrite={canWrite} onChanged={changed} /> : null}
        {tab === 'terms' ? <Terms canWrite={canWrite} onChanged={changed} /> : null}
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
