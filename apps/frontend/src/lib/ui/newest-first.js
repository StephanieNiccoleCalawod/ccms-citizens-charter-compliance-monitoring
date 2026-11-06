// The newest record first. A list that the service returns in another order (A to Z by name or code) is re-ordered here by the
// record's own `created_at`, so a record that was just created is the first row and stays there after a refresh.

const time = (record) => {
  const value = Date.parse(record?.created_at ?? '');
  return Number.isNaN(value) ? null : value;
};

/** Comparator: newest created_at first; a record with no readable created_at goes last; ties keep their incoming order (stable). */
export function byNewest(a, b) {
  const x = time(a);
  const y = time(b);
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return y - x;
}

/** A new array, newest first. */
export const sortNewestFirst = (items) => [...(items ?? [])].sort(byNewest);

/** The rows of one page of an already sorted list: { rows, total }. */
export function pageSlice(items, page, pageSize) {
  const start = (Math.max(1, page) - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), total: items.length };
}

/**
 * Every page of a server list (the server pages it, A to Z), so the whole result can be ordered newest first.
 * urlFor(page, size) builds the URL; the server's own filters and search stay in it.
 */
export async function fetchEveryPage(fetcher, urlFor, { size = 100, maxPages = 50 } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await fetcher(urlFor(page, size));
    const got = data?.items ?? [];
    items.push(...got);
    if (got.length === 0 || items.length >= (data?.total ?? items.length)) break;
  }
  return items;
}
