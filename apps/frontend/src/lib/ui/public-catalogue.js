// Rules for the public services page (Grid and List views), as pure functions (no React, no network).
//
// The public API (GET /api/catalogue/public/services) only understands `search` (a service or office name), `page` and
// `page_size` (at most 50). It has no classification or office filter and no list of offices. So the page asks for every page of
// the services that match the search, then filters by classification and office, counts and pages in the browser. The data is the
// API's own: nothing is invented, and an office or classification only appears if a returned service has it.

export const PUBLIC_PAGE_SIZE = 12;
export const PUBLIC_PAGE_SIZES = [12, 24, 48, 96]; // multiples of 12: whole rows in the 3-column grid
export const FETCH_PAGE_SIZE = 50; // the API's maximum
export const MAX_FETCH_PAGES = 40; // a safety stop: 2,000 services

export const CLASSIFICATION_FILTERS = [
  { value: '', label: 'All' },
  { value: 'SIMPLE', label: 'Simple' },
  { value: 'COMPLEX', label: 'Complex' },
  { value: 'HIGHLY_TECHNICAL', label: 'Highly technical' },
];

export const classificationFilterLabel = (value) => CLASSIFICATION_FILTERS.find((c) => c.value === value)?.label ?? value;

/**
 * Every service the API returns for a search, all pages, in the API's order (A to Z by name).
 * `fetchPage(page, pageSize)` returns { items, total }. Returns { items, total, truncated }: truncated is true only if the safety
 * stop was reached before the API's total, so the page can say the list is not complete.
 */
export async function loadAllServices(fetchPage, { maxPages = MAX_FETCH_PAGES, pageSize = FETCH_PAGE_SIZE } = {}) {
  const items = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await fetchPage(page, pageSize);
    const batch = data?.items ?? [];
    total = data?.total ?? items.length + batch.length;
    items.push(...batch);
    if (batch.length === 0 || items.length >= total) return { items, total, truncated: false };
  }
  return { items, total, truncated: items.length < total };
}

/** The office names in the services, A to Z, each once. The selected office stays in the list even if no service has it now. */
export function officeOptions(services, selected = '') {
  const names = new Set();
  for (const service of services) if (service.office_name) names.add(service.office_name);
  if (selected) names.add(selected);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** The services with the chosen classification and office ('' means all). The order is kept. */
export function filterServices(services, { classification = '', office = '' } = {}) {
  return services.filter((s) => (!classification || s.classification === classification) && (!office || s.office_name === office));
}

export const pageCount = (total, pageSize = PUBLIC_PAGE_SIZE) => Math.max(1, Math.ceil(total / pageSize));

/** A page number that exists (1 to the last page), whatever was asked for. */
export const clampPage = (page, total, pageSize = PUBLIC_PAGE_SIZE) => Math.min(Math.max(1, Number.isInteger(page) ? page : 1), pageCount(total, pageSize));

/** The services of one page of an already filtered list. */
export function pageOf(services, page, pageSize = PUBLIC_PAGE_SIZE) {
  const current = clampPage(page, services.length, pageSize);
  return services.slice((current - 1) * pageSize, current * pageSize);
}

/** True when a classification or an office narrows the list (a search alone is not counted here). */
export const hasNarrowing = ({ classification = '', office = '' } = {}) => Boolean(classification || office);

export const VIEWS = ['grid', 'list'];
export const normalizeView = (value) => (VIEWS.includes(value) ? value : 'grid');
