// The KPI module as the browser calls it (Sprint 5 TT3, Oversight), through the gateway:
//   GET /api/logs/analytics/kpis?period=&date=&from=&to=&office_id=&service_id=&group_by=total|office|service|staff
// The Office Home (CC036) and Campus Home (CC037) tiles come from this one call, the same figures the reports use.
// The server decides who may ask for what (the Executive is refused group_by=staff; Office Staff get only their own staff row).
import { apiFetch } from '../auth/session.js';
import { fetchAllPages, toQuery } from './client.js';
import { OFFICES_API } from './catalogue.js';
import { ACCOUNTS_API } from './identity.js';

export const KPIS_API = '/api/logs/analytics/kpis'; // the gateway maps /api/logs/* to Oversight's /api/*

export const getKpis = ({ period, date, from, to, officeId, serviceId, groupBy } = {}, fetcher = apiFetch) =>
  fetcher(`${KPIS_API}${toQuery({ period, date, from, to, office_id: officeId, service_id: serviceId, group_by: groupBy })}`);

/** office_id -> office name, for the Executive's per-office table. */
export async function getOfficeNames(fetcher = apiFetch) {
  const { items } = await fetcher(OFFICES_API);
  return new Map((items ?? []).map((office) => [office.office_id, office.office_name]));
}

/** account_id -> full name, for the Office Head's per-staff table. A name that cannot be found stays unnamed (never guessed). */
export async function getAccountNames(fetcher = apiFetch) {
  const items = await fetchAllPages(ACCOUNTS_API, fetcher);
  return new Map(items.map((account) => [account.account_id, account.full_name]));
}
