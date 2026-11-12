'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ComplaintStatus from '../../../components/complaints/ComplaintStatus.js';

// Public: check a complaint's status by reference (CC033). "?ref=" opens it already filled in.
function Status() {
  return <ComplaintStatus initialRef={useSearchParams().get('ref') ?? ''} />;
}

export default function ComplaintStatusPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500" aria-busy="true">Loading…</div>}>
      <Status />
    </Suspense>
  );
}
