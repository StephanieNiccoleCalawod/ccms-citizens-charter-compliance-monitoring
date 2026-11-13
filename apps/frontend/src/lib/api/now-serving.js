// CC059 "Now serving" for a waiting-area TV: public, no sign-in, display numbers only.
//   GET /api/catalogue/public/offices                        the active offices (to turn the code in the address into an office id)
//   GET /api/operations/queue/public/now-serving?office_id=  { queue_date, current, next[3] }
import { publicFetch, toQuery } from './client.js';
import { PUBLIC_OFFICES_API } from './complaints.js';

export const NOW_SERVING_API = '/api/operations/queue/public/now-serving';
export const findOfficeByCode = async (code, fetcher = publicFetch) => {
  const wanted = String(code ?? '').trim().toLowerCase();
  const items = (await fetcher(PUBLIC_OFFICES_API)).items ?? [];
  return items.find((o) => String(o.office_code ?? '').toLowerCase() === wanted) ?? null;
};
export const getNowServing = (officeId, fetcher = publicFetch) => fetcher(`${NOW_SERVING_API}${toQuery({ office_id: officeId })}`);
