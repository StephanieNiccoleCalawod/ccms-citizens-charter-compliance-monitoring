'use client';

import { useEffect, useState } from 'react';
import { getTransactionRatingCode } from '../../lib/api/ratings.js';
import { ratingLink, ratingPlainLink } from '../../lib/ui/ratings.js';
import { showCode } from '../../lib/ui/ratings.js';
import RatingQr from './RatingQr.js';

// CC057: on a completed transaction, the one-time rating code staff give to a citizen who has no email (it is also on the receipt email).
export default function RatingCodePanel({ transactionId }) {
  const [state, setState] = useState({ loading: true, code: null, used: false, failed: false });
  useEffect(() => {
    let live = true;
    getTransactionRatingCode(transactionId).then((r) => live && setState({ loading: false, code: r.code, used: r.used, failed: false })).catch(() => live && setState({ loading: false, code: null, used: false, failed: true }));
    return () => { live = false; };
  }, [transactionId]);
  if (state.loading || (!state.code && !state.failed)) return null;
  return (
    <div className="mt-4 rounded border border-slate-200 p-3 text-sm" data-testid="rating-code-panel">
      <p className="font-semibold text-slate-900">Service rating code</p>
      {state.failed ? <p className="text-slate-600">The code could not be loaded right now.</p> : (
        <>
          <p className="font-mono text-lg tracking-widest" data-testid="rating-code">{state.code}</p>
          <p className="text-xs text-slate-600">{state.used ? 'This code has been used.' : 'Give this to the citizen to rate the service on the Rate page. It works once.'}</p>
          {!state.used && typeof window !== 'undefined' ? (
            <>
              <div className="mt-3 print:hidden"><button type="button" className="btn-secondary" onClick={() => window.print()} data-testid="rating-print">Print rating slip</button></div>
              <div className="ack-print-area hidden print:block" data-testid="rating-slip">
                <h2 className="text-lg font-bold">Tell us how we served you</h2>
                <p className="mt-2 text-sm">Scan the code, or go to the link below and type your one-time code. It works once. We do not ask for your name or a comment.</p>
                <div className="mt-3 flex items-center gap-4">
                  <RatingQr value={ratingLink(window.location.origin, state.code)} size={160} />
                  <div>
                    <p className="font-mono text-xl tracking-widest" data-testid="rating-slip-code">{showCode(state.code)}</p>
                    <p className="mt-1 break-all text-sm" data-testid="rating-slip-link">{ratingPlainLink(window.location.origin)}</p>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
