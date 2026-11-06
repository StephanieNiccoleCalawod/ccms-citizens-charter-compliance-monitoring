'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ErrorBanner from '../../../components/feedback/ErrorBanner.js';
import PublicHeader from '../../../components/layout/PublicHeader.js';
import PublicServiceView from '../../../components/service/PublicServiceView.js';
import { publicFetch } from '../../../lib/api/client.js';
import { DIRECTORY_PATH } from '../../../lib/ui/public-directory.js';
import { PUBLIC_SERVICES_API } from '../../../lib/api/catalogue.js';

export default function PublicServiceDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [state, setState] = useState({ loading: true, service: null, error: null });

  function backToServices(event) {
    event.preventDefault();
    const cameFromCatalogue = window.sessionStorage.getItem('ccms:catalogue-return') === '1';
    window.sessionStorage.removeItem('ccms:catalogue-return');
    if (cameFromCatalogue && window.history.length > 1) router.back();
    else router.push(DIRECTORY_PATH);
  }

  useEffect(() => {
    let cancelled = false;
    publicFetch(`${PUBLIC_SERVICES_API}/${encodeURIComponent(id)}`)
      .then((data) => {
        if (!cancelled) setState({ loading: false, service: data.service, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, service: null, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const service = state.service;

  return (
    <div className="min-h-screen bg-slate-50">
      <PublicHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <Link href={DIRECTORY_PATH} onClick={backToServices} className="inline-flex items-center gap-2 rounded text-sm font-semibold text-maroon-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 4-6 6 6 6" />
          </svg>
          Back to all services
        </Link>
        <ErrorBanner message={state.error} />
        {state.loading ? <p className="text-sm text-slate-500">Loading service…</p> : null}
        {service ? (
          <PublicServiceView service={service} />
        ) : null}
      </main>
    </div>
  );
}
