// The KPI module as the browser calls it (Sprint 5 TT3, Oversight), through the gateway:
//   GET /api/logs/analytics/kpis?period=&date=&from=&to=&office_id=&service_id=&group_by=total|office|service|staff
// The Office Home (CC036) and Campus Home (CC037) tiles come from this one call, the same figures the reports use.
// The server decides who may ask for what (the Executive is refused group_by=staff; Office Staff get only their own staff row).
import { apiFetch } from '../auth/session.js';
import { oldestFirstPending } from '../ui/kpi-home.js';
import { fetchAllPages, toQuery } from './client.js';
import { periodParams } from '../ui/term-period.js';
import { OFFICES_API } from './catalogue.js';
import { listComplaintsForStaff } from './complaint-handling.js';
import { ACCOUNTS_API } from './identity.js';
import { listPendingTransactionsPage } from './transactions.js';

export const KPIS_API = '/api/logs/analytics/kpis'; // the gateway maps /api/logs/* to Oversight's /api/*

export const getKpis = ({ period, date, from, to, officeId, serviceId, groupBy } = {}, fetcher = apiFetch) =>
  fetcher(`${KPIS_API}${toQuery({ ...periodParams(period), date, from, to, office_id: officeId, service_id: serviceId, group_by: groupBy })}`);

/** office_id -> office name for every active office, for the Executive's per-office table. */
export async function getOfficeNames(fetcher = apiFetch) {
  const { items } = await fetcher(OFFICES_API);
  return new Map((items ?? []).filter((office) => office.is_active !== false).map((office) => [office.office_id, office.office_name]));
}

/** account_id -> full name, for the Office Head's per-staff table. A name that cannot be found stays unnamed (never guessed). */
export async function getAccountNames(fetcher = apiFetch) {
  const items = await fetchAllPages(ACCOUNTS_API, fetcher);
  return new Map(items.map((account) => [account.account_id, account.full_name]));
}

/** Paginated open transactions (IN_PROGRESS / ON_HOLD) for Office Home, ordered oldest first by the backend. */
export async function getOfficePendingTransactions({ page = 1, pageSize = 20 } = {}, fetcher = apiFetch) {
  if (typeof page === 'function') {
    // Backward compatibility if called directly as getOfficePendingTransactions(fetcher)
    return getOfficePendingTransactions({}, page);
  }
  const data = await listPendingTransactionsPage({ page, pageSize }, fetcher);
  return {
    items: oldestFirstPending(data?.items ?? []),
    page: data?.page ?? page,
    page_size: data?.page_size ?? pageSize,
    total: Number(data?.total ?? (data?.items?.length ?? 0)),
  };
}

/** Lightweight complaint counts for Office Home via existing CC034/CC035 endpoint; handles 403 cleanly for restricted staff. */
export async function getComplaintSummary({ officeId } = {}, fetcher = apiFetch) {
  try {
    const [received, acknowledged, overdue, resolved] = await Promise.all([
      listComplaintsForStaff({ officeId, status: 'RECEIVED', page: 1, pageSize: 1 }, fetcher),
      listComplaintsForStaff({ officeId, status: 'ACKNOWLEDGED', page: 1, pageSize: 1 }, fetcher),
      listComplaintsForStaff({ officeId, overdue: true, page: 1, pageSize: 1 }, fetcher),
      listComplaintsForStaff({ officeId, status: 'RESOLVED', page: 1, pageSize: 1 }, fetcher),
    ]);
    const rec = Number(received?.total ?? 0);
    const ack = Number(acknowledged?.total ?? 0);
    return {
      restricted: false,
      open: rec + ack,
      received: rec,
      acknowledged: ack,
      overdue: Number(overdue?.total ?? 0),
      resolved: Number(resolved?.total ?? 0),
    };
  } catch (err) {
    if (err?.status === 403) return { restricted: true };
    throw err;
  }
}
