// Request Access (S8-52 / D-AC-4), through the gateway (/api/identity/* reaches Identity).
//   GET  /api/identity/access-requests?status=        Super Admin: all requests; Office Head / Staff: their own  -> { items }
//   POST /api/identity/access-requests                { permission_key, reason } -> 201 { request }
//   POST /api/identity/access-requests/:id/decision   { decision: 'GRANT'|'DENY', ends_on?, note? } -> { request }   (Super Admin)
//   GET  /api/identity/access-grants                  Super Admin: the access that works now -> { items }
//   POST /api/identity/access-grants/:id/revoke       Super Admin
import { apiFetch } from '../auth/session.js';
import { toQuery } from './client.js';
import { IDENTITY_API } from './identity.js';

export const ACCESS_REQUESTS_API = `${IDENTITY_API}/access-requests`;
export const ACCESS_GRANTS_API = `${IDENTITY_API}/access-grants`;

export const listAccessRequests = ({ status } = {}, fetcher = apiFetch) => fetcher(`${ACCESS_REQUESTS_API}${toQuery({ status })}`);
export const createAccessRequest = ({ permissionKey, reason }, fetcher = apiFetch) => fetcher(ACCESS_REQUESTS_API, { method: 'POST', body: { permission_key: permissionKey, reason } });
export const decideAccessRequest = (id, { decision, endsOn, note }, fetcher = apiFetch) =>
  fetcher(`${ACCESS_REQUESTS_API}/${encodeURIComponent(id)}/decision`, { method: 'POST', body: { decision, ...(endsOn ? { ends_on: endsOn } : {}), ...(note ? { note } : {}) } });
export const listAccessGrants = (fetcher = apiFetch) => fetcher(ACCESS_GRANTS_API);
export const revokeAccessGrant = (id, fetcher = apiFetch) => fetcher(`${ACCESS_GRANTS_API}/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: {} });
