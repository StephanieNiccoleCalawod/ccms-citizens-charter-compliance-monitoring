// The two extra reads the "Record past transaction" form needs, through the gateway. Every call takes the fetcher as its
// last argument so tests can pass a fake; the default is the signed-in apiFetch. (Starting itself is POST /transactions in
// transactions.js: the same endpoint takes started_at, ended_at and backdate_reason.)
//
//   GET /api/catalogue/services/:id/standard?asOf=YYYY-MM-DD   the standard in force on that Manila date. The date is the one
//                                                               the person typed as the start; Core answers 404 STANDARD_NOT_FOUND
//                                                               when none was in force.
//   GET /api/operations/transactions?service_id=&from=&to=     saved records (Manila dates; the date of started_at), scoped by the
//                                                               server: Staff their own, Head their office, Super Admin all.
//                                                               Used only to check what exists after an unclear write.
import { apiFetch } from '../auth/session.js';
import { SERVICES_API } from './catalogue.js';
import { TRANSACTIONS_API } from './transactions.js';

export const getServiceStandardAsOf = (serviceId, asOf, fetcher = apiFetch) =>
  fetcher(`${SERVICES_API}/${encodeURIComponent(serviceId)}/standard?asOf=${encodeURIComponent(asOf)}`);

/** The saved records of one service that started on one Manila date (newest first). */
export const listRecordsOnDate = ({ serviceId, date }, fetcher = apiFetch) =>
  fetcher(`${TRANSACTIONS_API}?service_id=${encodeURIComponent(serviceId)}&from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}&page_size=50`);
