// Operations (transaction settings and counters) as the browser calls it, through the gateway:
// /api/operations/* arrives at the Operations service as /api/*. Each call takes the fetcher as its
// last argument so tests can pass a fake; the default is the signed-in apiFetch.
import { apiFetch } from '../auth/session.js';

export const OPERATIONS_API = '/api/operations';
export const SETTINGS_API = `${OPERATIONS_API}/settings`;
export const COUNTERS_API = `${OPERATIONS_API}/counters`;

export const countersUrl = (officeId) => (officeId ? `${COUNTERS_API}?officeId=${encodeURIComponent(officeId)}` : COUNTERS_API);

// GET /settings: any signed-in role. PUT /settings: Super Admin; the body is the full settings plus the version that was read.
export const getSettings = (fetcher = apiFetch) => fetcher(SETTINGS_API);
export const putSettings = (body, fetcher = apiFetch) => fetcher(SETTINGS_API, { method: 'PUT', body });

// GET /counters?officeId=: Super Admin any office; Office Head and Office Staff their own office. Executive: 403.
export const listCounters = (officeId, fetcher = apiFetch) => fetcher(countersUrl(officeId));
// POST and PUT take { office_id, label }. A counter is never deleted: deactivate and reactivate are PATCH.
export const createCounter = ({ office_id, label }, fetcher = apiFetch) => fetcher(COUNTERS_API, { method: 'POST', body: { office_id, label } });
export const updateCounter = (id, { office_id, label }, fetcher = apiFetch) => fetcher(`${COUNTERS_API}/${encodeURIComponent(id)}`, { method: 'PUT', body: { office_id, label } });
export const deactivateCounter = (id, fetcher = apiFetch) => fetcher(`${COUNTERS_API}/${encodeURIComponent(id)}/deactivate`, { method: 'PATCH' });
export const reactivateCounter = (id, fetcher = apiFetch) => fetcher(`${COUNTERS_API}/${encodeURIComponent(id)}/reactivate`, { method: 'PATCH' });
