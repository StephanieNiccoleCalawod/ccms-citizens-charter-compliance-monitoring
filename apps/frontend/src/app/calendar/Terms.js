'use client';

import { useCallback, useEffect, useState } from 'react';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import TableState from '../../components/ui/TableState.js';
import { formatDate } from '../../lib/ui/date-format.js';
import { apiFetch } from '../../lib/auth/session.js';
import { smsTermsNotice } from '../../lib/api/calendar.js';

const TERMS_API = '/api/calendar/terms';
const SMS_TERMS_API = '/api/calendar/terms/sms';

// The Syllabus Management System (SMS) owns the academic terms (PM decision, 11/06/2026): this tab only shows them.
// There is no Add and no Edit. While SMS_TERMS_ENABLED is on (Core answers enabled) the list comes from SMS; until then it
// shows the terms already stored in CCMS, also read-only.
export default function Terms() {
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [smsTerms, setSmsTerms] = useState(null);
  const fromSms = smsTerms?.enabled === true;
  const smsNotice = smsTermsNotice(smsTerms);

  const load = useCallback(async () => {
    try {
      const sms = await apiFetch(SMS_TERMS_API);
      setSmsTerms(sms);
      if (sms?.enabled) {
        setState({ loading: false, items: sms.items, error: null });
        return;
      }
      const data = await apiFetch(TERMS_API);
      setState({ loading: false, items: data.items, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: null }))} />
      <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-l-4 border-[#EAE3D9] border-l-gold-500 bg-white px-5 py-4">
        <p className="flex items-start gap-3 text-sm text-slate-800">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-[#7A5C00]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          <span>
            {fromSms
              ? 'Academic terms come from the Syllabus Management System (SMS) and cannot be changed here. They do not change how CCCMS computes deadlines.'
              : 'Academic terms are managed in the Syllabus Management System (SMS) and cannot be changed here. They do not change how CCCMS computes deadlines.'}
          </span>
        </p>
      </div>
      {smsNotice ? (
        <p className="text-sm font-semibold text-red-700" role="alert" data-testid="terms-notice">
          {smsNotice}
        </p>
      ) : null}
      <TableShell>
        <Table
          busy={state.loading}
          head={
            <tr>
              <Th>Term</Th>
              <Th>Start date</Th>
              <Th>End date</Th>
            </tr>
          }
        >
          {state.loading ? (
            <TableState colSpan={3} kind="loading">Loading terms…</TableState>
          ) : state.items.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-6 py-14 text-center">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="mx-auto h-9 w-9 text-stone-400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18M8 3v4M16 3v4" />
                </svg>
                <p className="mt-3 font-bold text-maroon-950">No academic terms yet</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                  The Syllabus Management System (SMS) has not provided any academic terms yet.
                </p>
              </td>
            </tr>
          ) : (
            state.items.map((term) => (
              <tr key={term.term_id ?? term.term_code} className="tr-row">
                <td className="td font-semibold text-slate-900">{term.term_name}</td>
                <td className="td">{formatDate(term.start_date) || '-'}</td>
                <td className="td">{formatDate(term.end_date) || '-'}</td>
              </tr>
            ))
          )}
        </Table>
      </TableShell>
    </div>
  );
}
