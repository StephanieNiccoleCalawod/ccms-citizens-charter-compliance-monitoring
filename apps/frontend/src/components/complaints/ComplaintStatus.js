'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import PublicHeader from '../layout/PublicHeader.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import { getComplaintStatus } from '../../lib/api/complaints.js';
import { normalizeReference, referenceError, statusLabel } from '../../lib/ui/complaints.js';

// CC033: the status of a complaint by its reference. Only the status is shown; an unknown reference shows "not found" and nothing else.
export default function ComplaintStatus({ initialRef = '' }) {
  const [ref, setRef] = useState(initialRef);
  const [problem, setProblem] = useState('');
  const [state, setState] = useState({ kind: 'idle' });
  const asked = useRef(false);

  async function check(value) {
    const reference = normalizeReference(value);
    const bad = referenceError(value);
    setProblem(bad);
    if (bad) return;
    setState({ kind: 'loading' });
    try {
      const result = await getComplaintStatus(reference);
      setState({ kind: 'found', reference: result.reference, status: result.status });
    } catch (failure) {
      setState(failure?.status === 404 ? { kind: 'missing' } : { kind: 'error', message: failure?.message || 'Something went wrong. Please try again in a few minutes.' });
    }
  }
  useEffect(() => {
    if (initialRef && !asked.current) { asked.current = true; check(initialRef); }
  }, [initialRef]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-slate-50">
      <PublicHeader />
      <main className="mx-auto max-w-xl px-4 py-8">
        <form className="card space-y-4 p-6" onSubmit={(event) => { event.preventDefault(); check(ref); }} noValidate data-testid="complaint-status-form">
          <h1 className="text-xl font-bold text-maroon-950">Check the status of a complaint</h1>
          <div>
            <label htmlFor="s-ref" className="label">Reference number</label>
            <input id="s-ref" className="input" value={ref} onChange={(event) => setRef(event.target.value)} placeholder="CMP-YYYYMMDD-XXXXXX" autoComplete="off" aria-invalid={Boolean(problem)} aria-describedby={problem ? 's-ref-error' : undefined} />
            {problem ? <p id="s-ref-error" className="mt-1 text-xs text-red-700">{problem}</p> : null}
          </div>
          <button type="submit" className="btn-primary" disabled={state.kind === 'loading'} aria-busy={state.kind === 'loading' || undefined}>{state.kind === 'loading' ? 'Checking…' : 'Check status'}</button>
          {state.kind === 'found' ? (
            <p className="text-sm" role="status" data-testid="complaint-status-result">Complaint <strong>{state.reference}</strong>: <strong>{statusLabel(state.status)}</strong></p>
          ) : null}
          {state.kind === 'missing' ? <p className="text-sm text-red-700" role="status" data-testid="complaint-status-missing">We could not find a complaint with that reference number. Check the number and try again.</p> : null}
          {state.kind === 'error' ? <ErrorBanner message={state.message} /> : null}
          <p className="text-sm"><Link href="/complaint" className="btn-link">File a complaint</Link></p>
        </form>
      </main>
    </div>
  );
}
