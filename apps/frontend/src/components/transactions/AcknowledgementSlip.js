'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import StatusBanner from '../feedback/StatusBanner.js';
import { getTransaction } from '../../lib/api/transactions.js';
import { acknowledgementSlip } from '../../lib/ui/acknowledgement.js';

function Row({ label, children, testId }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-3 border-b border-slate-200 py-2 last:border-b-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900" data-testid={testId}>{children}</dd>
    </div>
  );
}

/**
 * CC049: the printable Acknowledgement of a started transaction (browser print). Loaded through the normal transaction
 * read, so the usual access rules apply (Office Staff their own, Office Head their office, Super Admin any). Available
 * whether or not the client gave an email and whether or not the acknowledgement email was sent.
 */
export default function AcknowledgementSlip({ id }) {
  const [state, setState] = useState({ status: 'loading', tx: null, message: null });

  useEffect(() => {
    let cancelled = false;
    getTransaction(id)
      .then((tx) => !cancelled && setState({ status: 'ready', tx, message: null }))
      .catch((err) => !cancelled && setState({
        status: 'failed',
        tx: null,
        message: err?.status === 403 ? 'You do not have access to this transaction.' : err?.status === 404 ? 'This transaction was not found.' : 'The transaction could not be loaded. Please try again.',
      }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === 'loading') return <p className="text-sm text-slate-500">Loading the acknowledgement…</p>;
  if (state.status === 'failed') return <StatusBanner variant="error" message={state.message} />;

  const slip = acknowledgementSlip(state.tx);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <button type="button" className="btn-primary" onClick={() => window.print()}>Print</button>
        <Link href={`/transactions/${id}`} className="btn-secondary">Back to the transaction</Link>
      </div>
      <article className="ack-print-area card mx-auto max-w-xl p-8" aria-labelledby="ack-title" data-testid="acknowledgement-slip">
        <header className="flex items-center gap-4 border-b border-slate-300 pb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pup-logo.png" alt="Polytechnic University of the Philippines seal" width={72} height={72} className="h-[72px] w-[72px] rounded-full" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Polytechnic University of the Philippines</p>
            <h1 id="ack-title" className="text-lg">Acknowledgement of Receipt</h1>
          </div>
        </header>
        <dl className="mt-4">
          <Row label="Tracking number" testId="ack-tracking"><span className="font-mono text-base font-semibold">{slip.trackingNo}</span></Row>
          <Row label="Unit / office" testId="ack-office">{slip.office}</Row>
          <Row label="Service" testId="ack-service">{slip.service}</Row>
          <Row label="Received by" testId="ack-officer">{slip.officerName}</Row>
          <Row label="Position" testId="ack-position">{slip.officerPosition}</Row>
          <Row label="Date and time received" testId="ack-time">{slip.receivedAt}</Row>
        </dl>
        <p className="mt-6 text-sm font-semibold text-slate-900" data-testid="ack-quote">{slip.quoteLine}</p>
      </article>
    </div>
  );
}
