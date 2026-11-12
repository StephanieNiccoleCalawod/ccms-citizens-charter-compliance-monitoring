// Staff handling of complaints (CC034 / CC035), through the gateway (/api/logs/* reaches Oversight), with the signed-in token.
//   GET  /api/logs/complaints?office_id=&status=&overdue=true&page=&page_size=   { items, total, page, page_size }
//   GET  /api/logs/complaints/:id
//   POST /api/logs/complaints/:id/acknowledge
//   POST /api/logs/complaints/:id/resolve        { reply }
// Who may do what is decided by the server; the screen only follows it.
import { apiFetch } from '../auth/session.js';
import { toQuery } from './client.js';
import { COMPLAINTS_API } from './complaints.js';

const one = (id) => `${COMPLAINTS_API}/${encodeURIComponent(id)}`;
export const listComplaintsForStaff = ({ officeId, status, overdue, page, pageSize } = {}, fetcher = apiFetch) =>
  fetcher(`${COMPLAINTS_API}${toQuery({ office_id: officeId, status, overdue: overdue ? 'true' : undefined, page, page_size: pageSize })}`);
export const getComplaintForStaff = (id, fetcher = apiFetch) => fetcher(one(id));
export const acknowledgeComplaint = (id, fetcher = apiFetch) => fetcher(`${one(id)}/acknowledge`, { method: 'POST', body: {} });
export const resolveComplaint = (id, reply, fetcher = apiFetch) => fetcher(`${one(id)}/resolve`, { method: 'POST', body: { reply } });
