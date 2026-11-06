// The audit log as the browser calls it, through the gateway: /api/logs/* arrives at the Logs service as /api/*.
// Read only. The service accepts POST on this path from other CCMS services (service key), and the gateway
// blocks every browser method except GET and HEAD there; this client has no write call.
//
//   GET /audit-events?actor=&action=&entity_type=&office_id=&from=&to=&page=&page_size=
//     actor      a user ID (UUID), exact
//     action, entity_type   exact text, at most 80 characters
//     from, to   Manila calendar dates, YYYY-MM-DD; from is 00:00:00 and to is 23:59:59 that day
//     page (from 1), page_size (1-100, default 20); newest first (occurred_at DESC)
//   -> { items: [{ audit_id, actor_user_id, actor_role, action, entity_type, entity_id, office_id,
//                  before_value, after_value, ip_address, occurred_at }], page, page_size, total }
//   Super Admin: every entry. Office Head: their own office only. Office Staff and Executive: 403.
import { apiFetch } from '../auth/session.js';
import { toQuery } from './client.js';

export const LOGS_API = '/api/logs';
export const AUDIT_EVENTS_API = `${LOGS_API}/audit-events`;
export const AUDIT_PAGE_SIZE = 20;

/** The query string for the filters (blank ones are left out) and a page: "?actor=...&from=2026-11-01&page=1&page_size=20". */
export function auditQuery(filters, page = 1, pageSize = AUDIT_PAGE_SIZE) {
  return toQuery({
    actor: filters.actor,
    action: filters.action,
    entity_type: filters.entity_type,
    from: filters.from,
    to: filters.to,
    page,
    page_size: pageSize,
  });
}

export const auditEventsUrl = (filters, page, pageSize) => `${AUDIT_EVENTS_API}${auditQuery(filters, page, pageSize)}`;

export const listAuditEvents = (filters, page, fetcher = apiFetch, pageSize = AUDIT_PAGE_SIZE) =>
  fetcher(auditEventsUrl(filters, page, pageSize));
