// The public services list as the public page reads it: no login, through the gateway (/api/catalogue/public/services).
// The API only filters by `search` and pages with page / page_size (at most 50), so the page asks for each page in turn
// (see loadAllServices in ../ui/public-catalogue.js) and narrows by classification and office itself.
import { publicFetch, toQuery } from './client.js';
import { PUBLIC_SERVICES_API } from './catalogue.js';
import { loadAllServices } from '../ui/public-catalogue.js';

/** One page of the public services that match `search` ({ items, page, page_size, total }). */
export const fetchPublicServicesPage = (search, page, pageSize, fetcher = publicFetch) =>
  fetcher(`${PUBLIC_SERVICES_API}${toQuery({ search, page, page_size: pageSize })}`);

/** Every public service that matches `search`, all pages. */
export const listAllPublicServices = (search, fetcher = publicFetch) =>
  loadAllServices((page, pageSize) => fetchPublicServicesPage(search, page, pageSize, fetcher));
