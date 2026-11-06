// One place for how the browser talks to the API. Every call goes to the same address as the page
// (/api/...): the frontend project forwards it to the API gateway, which checks the token and routes
// it to Identity, Core or Logs. Pages never use a service address.

export { ApiError, apiFetch } from '../auth/session.js';

/** Fetches a public (no login) endpoint; turns HTTP 429 and other failures into readable messages. */
export async function publicFetch(path) {
  let response;
  try {
    response = await fetch(path, { headers: { accept: 'application/json' } });
  } catch {
    const error = new Error('Cannot reach the server. Check your connection and try again.');
    error.status = 0;
    throw error;
  }
  if (response.status === 429) {
    const wait = Number(response.headers.get('retry-after'));
    let message = 'Too many requests. Please wait a moment and try again.';
    try {
      const body = await response.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* keep the default message */
    }
    if (wait > 0) message += ` (try again in about ${wait} second${wait === 1 ? '' : 's'})`;
    const error = new Error(message);
    error.status = 429;
    throw error;
  }
  if (!response.ok) {
    let message = response.status === 404 ? 'This service could not be found.' : 'Something went wrong. Please try again.';
    try {
      const body = await response.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* keep the default message */
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function toQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value).trim());
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

/**
 * Every item of a paged list (`{ items, total }`), fetched page by page. `extra` are fixed query values (for example
 * { status: 'all' }). Stops at `maxPages` as a safety limit and returns what it has. Used for name lookups, where a
 * missing name is shown as unavailable rather than guessed.
 */
export async function fetchAllPages(path, fetcher, { extra = {}, pageSize = 100, maxPages = 50 } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await fetcher(`${path}${toQuery({ ...extra, page, page_size: pageSize })}`);
    const batch = data?.items ?? [];
    items.push(...batch);
    if (batch.length === 0 || items.length >= (data?.total ?? 0)) break;
  }
  return items;
}
