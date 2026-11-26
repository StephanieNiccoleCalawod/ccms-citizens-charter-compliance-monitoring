'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { getPeopleReport } from '../../lib/api/reports.js';
import { todayManila } from '../../lib/api/calendar.js';
import { buildPeopleQuery, peopleFailureMessage, scopesFor } from '../../lib/ui/people-report.js';
import { ROLES } from 'ccms-shared/roles';
import LockedNotice from '../access/LockedNotice.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import { canRequestAccess } from '../../lib/ui/access.js';
import DateHint from '../forms/DateHint.js';
import { usePersistentState } from '../../lib/ui/persistent-state.js';
import { setViewedReport } from '../../lib/ui/report-view-store.js';

/**
 * S8-54 / S8-55 / S8-6x: reports for one office, one person, or every staff member of an office. The server decides
 * who may see which (Super Admin any office, Office Head their own office, Office Staff themselves). Generating one
 * navigates to the dedicated report page (/reports/view, see ReportView.js and PeopleReportSheet.js) instead of
 * showing it here, so this form's own fields are all that stays - kept, with `persistKey`, across that round trip.
 */
export default function PeopleReport({ user, offices, hideHeading = false, compact = false, persistKey = 'default', formId, onGenerated, onStateChange }) {
  const router = useRouter();
  const scopes = scopesFor(user.role);
  const own = user.role === ROLES.OFFICE_STAFF;
  const today = todayManila();
  const key = (name) => `people-report:${persistKey}:${name}`;
  const [scope, setScope] = usePersistentState(key('scope'), scopes[0]?.value ?? 'person');
  const [officeId, setOfficeId] = usePersistentState(key('officeId'), user.role === ROLES.SUPER_ADMIN ? '' : (user.officeId ?? ''));
  const [personId, setPersonId] = usePersistentState(key('personId'), '');
  const [from, setFrom] = usePersistentState(key('from'), `${today.slice(0, 8)}01`);
  const [to, setTo] = usePersistentState(key('to'), today);
  const [people, setPeople] = usePersistentState(key('people'), []); // the roster for the person picker, read with the "every staff member" scope
  const [state, setState] = usePersistentState(key('state'), { loading: false, error: '', locked: false });

  // S8-6x: a Super Admin's "Whole office" has no office to pick - it is every office combined, so the field is
  // hidden rather than shown with nothing useful to choose (see buildPeopleQuery, which drops officeId the same way).
  const allOffices = user.role === ROLES.SUPER_ADMIN && scope === 'office';
  const officeName = allOffices ? 'All offices' : (offices.find((o) => o.office_id === (user.role === ROLES.SUPER_ADMIN ? officeId : user.officeId))?.office_name ?? '');
  const canSubmit = !buildPeopleQuery({ role: user.role, scope, officeId, personId, from, to, user }).error;

  // Lets an external "Generate Report" button (the shared modal footer) show the same disabled-until-valid and
  // loading behaviour as the office report's, instead of only finding out it was missing an office after clicking.
  useEffect(() => {
    onStateChange?.({ loading: state.loading, canSubmit });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onStateChange is a plain callback, not reactive state
  }, [state.loading, canSubmit]);

  // The person picker lists the staff of the chosen office. It is read the same way as the report (server-checked).
  useEffect(() => {
    if (scope !== 'person' || own) return undefined;
    const office = user.role === ROLES.SUPER_ADMIN ? officeId : user.officeId;
    if (!office) return undefined;
    let cancelled = false;
    getPeopleReport({ scope: 'all_staff', officeId: office, from: today, to: today })
      .then((data) => !cancelled && setPeople((data.items ?? []).filter((p) => p.person_id)))
      .catch(() => !cancelled && setPeople([]));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setPeople is stable (usePersistentState)
  }, [scope, officeId, own, user, today]);

  async function run(event) {
    event.preventDefault();
    const query = buildPeopleQuery({ role: user.role, scope, officeId, personId, from, to, user });
    if (query.error) { setState({ loading: false, error: query.error }); return; }
    setState({ loading: true, error: '' });
    try {
      const report = await getPeopleReport(query);
      const personName = people.find((p) => p.person_id === personId)?.person_name ?? report?.items?.[0]?.person_name ?? '';
      setState({ loading: false, error: '' });
      setViewedReport({ kind: 'person', report, officeName, personName, generatedBy: user.fullName });
      onGenerated?.();
      router.push('/reports/view');
    } catch (failure) {
      setState({ loading: false, error: peopleFailureMessage(failure), locked: failure?.status === 403 });
    }
  }

  return (
    <section className="space-y-3" aria-labelledby={hideHeading ? undefined : 'people-report-heading'} aria-label={hideHeading ? 'Report by person' : undefined} data-testid="people-report">
      {hideHeading ? null : (
        <div className="print:hidden">
          <h2 id="people-report-heading" className="text-base font-semibold text-slate-900">Reports by person</h2>
          <p className="text-sm text-slate-500">See the work of your office, of one person, or of every staff member for the dates you choose.</p>
        </div>
      )}
      <form id={formId} onSubmit={run} className={`${compact ? '' : 'card p-4'} space-y-4 print:hidden`} aria-label="Report by person">
        {!own ? (
          <div className="w-full sm:w-64">
            <label htmlFor="pr-scope" className="label">Report for</label>
            <select id="pr-scope" className="input select-chevron" value={scope} onChange={(e) => {
              const next = e.target.value;
              setScope(next);
              setPersonId('');
              // "Whole office" has no office of its own to keep (see above) - clear it so a value chosen under
              // Every staff member/One person is never silently carried into an all-offices generate.
              if (next === 'office' && user.role === ROLES.SUPER_ADMIN) setOfficeId('');
            }}>
              {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        ) : null}
        {user.role === ROLES.SUPER_ADMIN && !allOffices ? (
          <div className="w-full sm:w-64">
            <label htmlFor="pr-office" className="label">Office</label>
            <select id="pr-office" className="input select-chevron" value={officeId} onChange={(e) => { setOfficeId(e.target.value); setPersonId(''); }}>
              <option value="">Choose an office</option>
              {offices.map((o) => <option key={o.office_id} value={o.office_id}>{o.office_name}</option>)}
            </select>
          </div>
        ) : null}
        {scope === 'person' && !own ? (
          <div className="w-full sm:w-64">
            <label htmlFor="pr-person" className="label">Person</label>
            <select id="pr-person" className="input select-chevron" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">Choose a person</option>
              {people.map((p) => <option key={p.person_id} value={p.person_id}>{p.person_name || 'Name not available'}</option>)}
            </select>
          </div>
        ) : null}
        <div className="flex gap-4">
          <div className="flex-1">
            <label htmlFor="pr-from" className="label">From</label>
            <input id="pr-from" type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-describedby="pr-from-hint" />
            <DateHint id="pr-from-hint" />
          </div>
          <div className="flex-1">
            <label htmlFor="pr-to" className="label">To</label>
            <input id="pr-to" type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-describedby="pr-to-hint" />
            <DateHint id="pr-to-hint" />
          </div>
        </div>
      </form>
      {state.locked && canRequestAccess(user.role)
        ? <LockedNotice permissionKey="REPORTS_PER_PERSON" role={user.role} />
        : <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: '' }))} />}
    </section>
  );
}
