'use client';

import { useState } from 'react';
import { submitRating } from '../../lib/api/ratings.js';
import { STAR_LABEL, STAR_VALUES, cleanCode, ratingErrors, ratingFailure, showCode } from '../../lib/ui/ratings.js';
import PublicHeader from '../layout/PublicHeader.js';

// Public rating page (CC057): no sign-in, a code from the receipt, 1 to 5 stars, once per code. No name, no comment, nothing about the person.
export default function RatePage() {
  const [code, setCode] = useState('');
  const [stars, setStars] = useState(0);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const found = ratingErrors({ code, stars });
    setErrors(found); setProblem('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try { setDone(await submitRating({ code: cleanCode(code), stars })); } catch (failure) { setProblem(ratingFailure(failure)); } finally { setBusy(false); }
  }

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-lg px-4 py-10" data-testid="rate-page">
        {done ? (
          <div className="card space-y-2 p-6 text-center" role="status" data-testid="rate-thanks">
            <h1 className="text-xl font-bold text-maroon-950">Thank you!</h1>
            <p className="text-sm text-slate-700">Your rating of {done.service_name ? `“${done.service_name}”` : 'the service'} was received. The code cannot be used again.</p>
          </div>
        ) : (
          <form className="card space-y-5 p-6" onSubmit={submit} noValidate>
            <div>
              <h1 className="text-xl font-bold text-maroon-950">Rate the service you received</h1>
              <p className="mt-1 text-sm text-slate-600">Enter the code on your receipt and choose a number of stars. We do not ask for your name or a comment.</p>
            </div>
            {problem ? <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="rate-problem">{problem}</p> : null}
            <div>
              <label htmlFor="rate-code" className="label">Code from your receipt</label>
              <input id="rate-code" className="input font-mono tracking-widest" inputMode="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX"
                value={showCode(code)} onChange={(e) => setCode(e.target.value)} aria-invalid={Boolean(errors.code)} aria-describedby={errors.code ? 'rate-code-error' : undefined} />
              {errors.code ? <p id="rate-code-error" className="mt-1 text-xs text-red-700">{errors.code}</p> : null}
            </div>
            <fieldset>
              <legend className="label">Your rating</legend>
              <div className="mt-1 flex gap-2" role="radiogroup" aria-label="Stars">
                {STAR_VALUES.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n === 1 ? '' : 's'}, ${STAR_LABEL[n]}`} onClick={() => setStars(n)}
                    className={`h-12 w-12 rounded-md border text-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700 ${n <= stars ? 'border-amber-400 bg-amber-100 text-amber-600' : 'border-slate-300 bg-white text-slate-300'}`} data-testid={`star-${n}`}>★</button>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-600">{stars ? STAR_LABEL[stars] : 'Choose 1 (very poor) to 5 (excellent).'}</p>
              {errors.stars ? <p className="mt-1 text-xs text-red-700">{errors.stars}</p> : null}
            </fieldset>
            <button type="submit" className="btn-primary w-full" disabled={busy} data-testid="rate-submit">{busy ? 'Sending…' : 'Send my rating'}</button>
          </form>
        )}
      </main>
    </>
  );
}
