'use client';

import { useEffect, useState } from 'react';
import { getRatingSummary } from '../../lib/api/ratings.js';
import { averageText } from '../../lib/ui/ratings.js';
import TableShell, { Table, Th } from '../ui/TableShell.js';

// CC057 / CC029 AC4: citizen ratings for the report's office and period, apart from the compliance figures (never part of them).
export default function RatingsSection({ officeId, from, to }) {
  const [state, setState] = useState({ loading: true, data: null, failed: false });
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show "loading" while the ratings for the new office or period are read
    setState({ loading: true, data: null, failed: false });
    getRatingSummary({ officeId, from, to }).then((data) => live && setState({ loading: false, data, failed: false })).catch(() => live && setState({ loading: false, data: null, failed: true }));
    return () => { live = false; };
  }, [officeId, from, to]);
  return (
    <section className="mt-4" aria-label="Service ratings" data-testid="report-ratings">
      <h3 className="font-bold text-maroon-950">Service ratings</h3>
      <p className="text-xs text-slate-500">From citizens who used the code on their receipt (1 to 5 stars). Shown apart from compliance; they do not change any compliance figure.</p>
      {state.loading ? <p className="mt-2 text-sm text-slate-600">Loading…</p> : null}
      {state.failed ? <p className="mt-2 text-sm text-slate-600">Ratings are not available right now.</p> : null}
      {state.data && state.data.items.length === 0 ? <p className="mt-2 text-sm text-slate-600">No ratings in this period.</p> : null}
      {state.data && state.data.items.length > 0 ? (
        <TableShell>
          <Table label="Service ratings" minWidth="28rem" head={<tr><Th>Service</Th><Th align="right">Ratings</Th><Th align="right">Average</Th></tr>}>
            {state.data.items.map((i) => (
              <tr key={i.service_id} className="tr-row"><td className="td">{i.service_name}</td><td className="td text-right">{i.count}</td><td className="td text-right">{averageText(i.average)}</td></tr>
            ))}
            <tr className="tr-row font-bold"><td className="td">All services</td><td className="td text-right">{state.data.total_count}</td><td className="td text-right">{averageText(state.data.average)}</td></tr>
          </Table>
        </TableShell>
      ) : null}
    </section>
  );
}
