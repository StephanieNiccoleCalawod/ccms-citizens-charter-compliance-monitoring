'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { findOfficeByCode, getNowServing } from '../../lib/api/now-serving.js';
import { createPoller } from '../../lib/ui/analytics.js';
import { INITIAL, REFRESH_MS, failed, headline, isStale, succeeded } from '../../lib/ui/now-serving.js';

// "Now serving" for a TV in the waiting area (CC059): public, read-only, large text, the current ticket and the next 3, refreshed every 5
// seconds. Display numbers only, nothing about a person. The office code comes from the address (/queue/<office code>/now-serving).
export default function NowServingScreen() {
  const { officeCode } = useParams();
  const [office, setOffice] = useState({ state: 'loading', value: null });
  const [data, setData] = useState(INITIAL);
  const dataRef = useRef(INITIAL);

  useEffect(() => {
    let live = true;
    findOfficeByCode(decodeURIComponent(String(officeCode ?? ''))).then((o) => live && setOffice(o ? { state: 'ok', value: o } : { state: 'missing', value: null })).catch(() => live && setOffice({ state: 'error', value: null }));
    return () => { live = false; };
  }, [officeCode]);

  useEffect(() => {
    if (office.state !== 'ok') return undefined;
    const poller = createPoller({
      load: () => getNowServing(office.value.office_id),
      intervalMs: REFRESH_MS,
      isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
      onSuccess: (view) => { dataRef.current = succeeded(view, Date.now()); setData(dataRef.current); },
      onError: () => { dataRef.current = failed(dataRef.current); setData(dataRef.current); },
    });
    poller.start();
    const onVisible = () => { if (document.visibilityState === 'visible') poller.resumeIfStale(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); poller.stop(); };
  }, [office]);

  if (office.state === 'missing') return <Screen><p className="text-center text-3xl">This office was not found.</p></Screen>;
  if (office.state === 'error' || data.status === 'error') return <Screen><p className="text-center text-3xl" role="status">The queue cannot be shown right now. Trying again…</p></Screen>;
  if (office.state === 'loading' || data.status === 'loading') return <Screen><p className="text-center text-3xl" role="status">Loading…</p></Screen>;

  return (
    <Screen title={office.value.office_name}>
      <section aria-live="polite" className="text-center" data-testid="now-serving-current">
        <p className="text-[clamp(1.5rem,4vw,3rem)] font-semibold uppercase tracking-widest text-amber-300">Now serving</p>
        <p className={`mt-4 font-extrabold leading-none ${data.view.current ? 'text-[clamp(4rem,16vw,14rem)]' : 'text-[clamp(2rem,6vw,5rem)]'}`}>{headline(data.view)}</p>
      </section>
      <section className="mt-12 text-center" data-testid="now-serving-next">
        <p className="text-[clamp(1.25rem,3vw,2.25rem)] font-semibold uppercase tracking-widest text-slate-300">Next</p>
        {data.view.next.length === 0 ? <p className="mt-3 text-[clamp(1.25rem,3vw,2.25rem)] text-slate-300">No one is waiting</p> : (
          <ol className="mt-3 flex flex-wrap justify-center gap-x-10 gap-y-3 text-[clamp(2rem,7vw,6rem)] font-bold">
            {data.view.next.map((n) => <li key={n}>{n}</li>)}
          </ol>
        )}
      </section>
      {isStale(data) ? <p className="mt-10 text-center text-[clamp(1rem,2vw,1.5rem)] text-amber-300" role="status" data-testid="now-serving-stale">Reconnecting… the numbers above may be out of date.</p> : null}
    </Screen>
  );
}

function Screen({ title, children }) {
  return (
    <main className="flex min-h-screen flex-col justify-center bg-slate-900 px-6 py-8 text-white" data-testid="now-serving-screen">
      {title ? <h1 className="mb-8 text-center text-[clamp(1.25rem,3vw,2.5rem)] font-bold">{title}</h1> : null}
      {children}
    </main>
  );
}
