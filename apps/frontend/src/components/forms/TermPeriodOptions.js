'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadTerms } from '../../lib/api/terms.js';
import { termChoices } from '../../lib/ui/term-period.js';

/** The terms for a period selector, read once. `loaded` is false until the answer arrives. */
export function useTerms() {
  const [state, setState] = useState({ terms: [], loaded: false });
  useEffect(() => {
    let active = true;
    loadTerms().then((terms) => { if (active) setState({ terms, loaded: true }); });
    return () => { active = false; };
  }, []);
  return state;
}

/**
 * The "Academic term" and "School year" groups of a period <select>. With no terms both are shown greyed out (the sentence that
 * explains why is TERMS_NOT_AVAILABLE, shown by the screen under the selector).
 */
export default function TermPeriodOptions({ terms }) {
  const { terms: termList, years } = useMemo(() => termChoices(terms), [terms]);
  return (
    <>
      <optgroup label="Academic term" disabled={termList.length === 0}>
        {termList.length ? termList.map((o) => <option key={o.value} value={o.value}>{o.label}</option>) : <option disabled>Not available yet</option>}
      </optgroup>
      <optgroup label="School year" disabled={years.length === 0}>
        {years.length ? years.map((o) => <option key={o.value} value={o.value}>{o.label}</option>) : <option disabled>Not available yet</option>}
      </optgroup>
    </>
  );
}
