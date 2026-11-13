'use client';

import { useEffect, useState } from 'react';
import { getTransactionRatingCode } from '../../lib/api/ratings.js';

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
        </>
      )}
    </div>
  );
}
