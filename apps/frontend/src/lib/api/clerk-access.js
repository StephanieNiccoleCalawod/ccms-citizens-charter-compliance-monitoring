// Clerk sign-in access (Landas 1), Super Admin only. All through the gateway to Identity.
//   GET    /api/identity/clerk-access/requests        -> { items: [{ clerk_user_id, email, first_seen_at, last_seen_at, suggested_account }] }
//   DELETE /api/identity/clerk-access/requests/{id}   -> 204 (dismiss a pending sign-in)
//   GET    /api/identity/clerk-access/links           -> { items: [{ account_id, linked_at, linked_by }] }
//   PUT    /api/identity/accounts/{id}/clerk-link     { clerk_user_id } -> { account_id, linked_at, linked_by }
//   DELETE /api/identity/accounts/{id}/clerk-link     -> 204
import { apiFetch } from '../auth/session.js';
import { ACCOUNTS_API, IDENTITY_API } from './identity.js';

const BASE = `${IDENTITY_API}/clerk-access`;

export const listClerkAccessRequests = () => apiFetch(`${BASE}/requests`);
export const dismissClerkAccessRequest = (clerkUserId) => apiFetch(`${BASE}/requests/${encodeURIComponent(clerkUserId)}`, { method: 'DELETE' });
export const listClerkLinks = () => apiFetch(`${BASE}/links`);
export const linkAccountToClerk = (accountId, clerkUserId) =>
  apiFetch(`${ACCOUNTS_API}/${encodeURIComponent(accountId)}/clerk-link`, { method: 'PUT', body: { clerk_user_id: clerkUserId } });
export const unlinkAccountFromClerk = (accountId) => apiFetch(`${ACCOUNTS_API}/${encodeURIComponent(accountId)}/clerk-link`, { method: 'DELETE' });

/** Active accounts for the "bind to" choice (the Accounts API pages at most 100 per request). */
export async function listActiveAccounts() {
  const items = [];
  for (let page = 1; page <= 50; page += 1) {
    const body = await apiFetch(`${ACCOUNTS_API}?status=active&page=${page}&page_size=100`);
    items.push(...(body?.items ?? []));
    if (!body || items.length >= body.total || !body.items?.length) break;
  }
  return items;
}
