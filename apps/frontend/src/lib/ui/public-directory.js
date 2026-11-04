// Rules for the public Service Directory (split-screen home), as pure functions (no React, no network).
// Everything is worked out from the services the public API returned: nothing here is typed in by hand.

export const DIRECTORY_PAGE_SIZE = 10;

export const TIME_FILTERS = [
  { value: '', label: 'Any time' },
  { value: '10', label: 'Under 10 min' },
  { value: '20', label: 'Under 20 min' },
];

/**
 * A service's standard in minutes, only when it is a pure time standard (no working days). A standard with working days is not
 * turned into minutes (the length of a working day depends on the campus calendar), so it has no minutes and is never "under N min".
 */
export function standardMinutes(service) {
  const days = Number(service?.duration_days) || 0;
  if (days > 0) return null;
  return (Number(service?.duration_hours) || 0) * 60 + (Number(service?.duration_minutes) || 0);
}

/** The services whose standard is strictly under `limit` minutes ('' means any time). */
export function filterByTime(services, limit) {
  const max = Number(limit);
  if (!limit || !Number.isFinite(max)) return services;
  return services.filter((s) => {
    const minutes = standardMinutes(s);
    return minutes !== null && minutes < max;
  });
}

/** Name order: 'asc' is A to Z, 'desc' Z to A. A copy is returned; ties keep the API's order. */
export function sortByName(services, direction = 'asc') {
  const sign = direction === 'desc' ? -1 : 1;
  return [...services].sort((a, b) => sign * a.service_name.localeCompare(b.service_name, undefined, { sensitivity: 'base' }));
}

/** { total, offices: [{ name, count }] } for every office in the services (A to Z), from the data itself. */
export function officeCounts(services) {
  const counts = new Map();
  for (const s of services) if (s.office_name) counts.set(s.office_name, (counts.get(s.office_name) ?? 0) + 1);
  return {
    total: services.length,
    offices: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
  };
}

/** The "Showing 11-20 of 36" numbers from a 1-based page, the page size and the total. */
export function showingRange(page, pageSize, total) {
  if (!total) return { from: 0, to: 0 };
  return { from: (page - 1) * pageSize + 1, to: Math.min(total, page * pageSize) };
}

/** 1 -> "01", 12 -> "12", 105 -> "105". */
export const sequenceLabel = (n) => String(n).padStart(2, '0');

/** The public Service Directory: the page the landing page sends people to. */
export const DIRECTORY_PATH = '/directory';

/** The directory, optionally opened with a search already applied (?q=). An empty search is just the directory. */
export function directoryHref(query) {
  const q = String(query ?? '').trim();
  return q ? `${DIRECTORY_PATH}?q=${encodeURIComponent(q)}` : DIRECTORY_PATH;
}
