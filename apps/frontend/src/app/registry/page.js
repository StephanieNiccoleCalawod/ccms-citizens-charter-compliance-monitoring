'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import Button from '../../components/ui/Button.js';
import RowActionMenu from '../../components/ui/RowActionMenu.js';
import StatusBanner from '../../components/feedback/StatusBanner.js';
import { getRegistrySummary, isRegistryDemo, listRegistryImports, registryFetcher } from '../../lib/api/registry.js';
import { describeFailure, normalizeHistory, normalizeSummary } from '../../lib/ui/registry-import.js';
import ImportHistory from './ImportHistory.js';
import ImportPanel from './ImportPanel.js';
import RegistryOverview from './RegistryOverview.js';

const VIEWS = {
  main: { title: 'Student and Alumni Registry', subtitle: 'Import the registry from a CSV or XLSX file. Check the file first: an import is all or nothing.' },
  history: { title: 'Import History', subtitle: 'Previous imports to the registry, newest first.' },
};

/** The clock-with-arrow glyph for the "History" menu item (the same shape as the sidebar's Logs icon). */
function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12a8 8 0 1 0 2.5-5.8" />
      <path d="M4 4v4h4" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

function RegistryManager({ view, onBack }) {
  const demo = isRegistryDemo();
  const [summary, setSummary] = useState({ loading: true, data: null, error: null });
  const [history, setHistory] = useState({ loading: true, items: [], error: null });
  const [importOpen, setImportOpen] = useState(false);
  // Changes every time the modal is opened, so ImportPanel remounts with a clean slate instead of showing
  // whatever file, check or result was left over from the last time it was open.
  const [importKey, setImportKey] = useState(0);

  // Fetching sets no state; the answers are applied by the caller, so the first load is an ordinary effect. History is
  // fetched here, up front, together with the summary (one request each, the same as before) even though it is shown
  // only once the "History" menu item is opened: that way opening it is instant and never asks the service twice.
  const fetchAll = useCallback(() => {
    const fetcher = registryFetcher();
    return Promise.allSettled([getRegistrySummary(fetcher), listRegistryImports(fetcher)]);
  }, []);

  const apply = useCallback(([s, h]) => {
    setSummary(s.status === 'fulfilled' ? { loading: false, data: normalizeSummary(s.value), error: null } : { loading: false, data: null, error: describeFailure(s.reason) });
    setHistory(h.status === 'fulfilled' ? { loading: false, items: normalizeHistory(h.value), error: null } : { loading: false, items: [], error: describeFailure(h.reason) });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAll().then((answers) => !cancelled && apply(answers));
    return () => {
      cancelled = true;
    };
  }, [fetchAll, apply]);

  const reload = useCallback(() => fetchAll().then(apply), [fetchAll, apply]);

  if (view === 'history') {
    return (
      <div className="space-y-4">
        <Button variant="secondary" onClick={onBack}>&larr; Back to Registry</Button>
        <ImportHistory history={history} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {demo ? (
        <StatusBanner variant="warning" message="Demo mode: this screen is using sample data kept in your browser tab, not the registry service. Nothing is saved." />
      ) : null}
      <RegistryOverview summary={summary} onImportClick={() => { setImportKey((k) => k + 1); setImportOpen(true); }} />
      <ImportPanel key={importKey} open={importOpen} onClose={() => setImportOpen(false)} demo={demo} onImported={reload} />
    </div>
  );
}

export default function RegistryPage() {
  const [view, setView] = useState('main'); // 'main' | 'history'
  const heading = VIEWS[view];

  return (
    <AppShell
      title={heading.title}
      subtitle={heading.subtitle}
      allowedRoles={[ROLES.SUPER_ADMIN]}
      headerRight={
        view === 'main' ? (
          <RowActionMenu
            vertical
            label="Registry options"
            triggerClassName="icon-button-outline"
            items={[{ label: 'History', icon: <HistoryIcon />, onSelect: () => setView('history') }]}
          />
        ) : null
      }
    >
      <RegistryManager view={view} onBack={() => setView('main')} />
    </AppShell>
  );
}
