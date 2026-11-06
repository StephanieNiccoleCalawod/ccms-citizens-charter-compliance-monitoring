'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PublicDirectory from '../../components/public/PublicDirectory.js';
import { useCatalogue } from '../../lib/ui/use-catalogue.js';

// The public Service Directory (no login). "?q=" opens it with that search already applied (the landing page's search box).
function Directory() {
  const initialSearch = useSearchParams().get('q') ?? '';
  const catalogue = useCatalogue(initialSearch);
  return <PublicDirectory catalogue={catalogue} />;
}

export default function DirectoryPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500" aria-busy="true">Loading services…</div>}>
      <Directory />
    </Suspense>
  );
}
