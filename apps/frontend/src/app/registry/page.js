'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import StatusBanner from '../../components/feedback/StatusBanner.js';
import { getRegistrySummary, isRegistryDemo, listRegistryImports, registryFetcher } from '../../lib/api/registry.js';
import { describeFailure, normalizeHistory, normalizeSummary } from '../../lib/ui/registry-import.js';
import ImportHistory from './ImportHistory.js';
import ImportPanel from './ImportPanel.js';
import RegistryOverview from './RegistryOverview.js';

function RegistryManager() {
  const demo = isRegistryDemo();
  const [summary, setSummary] = useState({ loading: true, data: null, error: null });
  const [history, setHistory] = useState({ loading: true, items: [], error: null });

  // Fetching sets no state; the answers are applied by the caller, so the first load is an ordinary effect.
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

  return (
    <div className="space-y-6">
      {demo ? (
        <StatusBanner variant="warning" message="Demo mode: this screen is using sample data kept in your browser tab, not the registry service. Nothing is saved." />
      ) : null}
      <RegistryOverview summary={summary} />
      <ImportPanel demo={demo} onImported={reload} />
      <ImportHistory history={history} />
    </div>
  );
}

export default function RegistryPage() {
  return (
    <AppShell
      title="Student and Alumni Registry"
      subtitle="Import the registry from a CSV or XLSX file. Check the file first: an import is all or nothing."
      allowedRoles={[ROLES.SUPER_ADMIN]}
    >
      <RegistryManager />
    </AppShell>
  );
}
