import { AppError } from 'ccms-shared';

// Office and service names for a report. Oversight keeps no catalogue, so the names are asked of Core once, when a draft is
// generated, using the caller's own token (Core applies its own rules for that person), and are kept inside the report's figures:
// a published report never changes when an office or service is renamed later.
export function coreBaseUrl(env = process.env) {
  const raw = String(env.CORE_URL ?? env.CORE_SERVICE_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}

const unavailable = (why) => new AppError(503, 'CORE_UNAVAILABLE', 'The office and service names could not be loaded right now. Nothing was saved. Please try again in a few minutes.', { why });

async function getJson(url, authorization, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json', authorization }, signal: AbortSignal.timeout(5000) });
  } catch (err) {
    throw unavailable(err?.name === 'TimeoutError' ? 'timeout' : 'unreachable');
  }
  if (!response.ok) throw unavailable(`status ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw unavailable('unreadable answer');
  }
}

/**
 * { officeName, services: Map(service_id -> service_name) } for one office. A service missing from Core's list (for example one
 * that has since been switched off, which only a Super Admin lists) has no name; the report shows it without one.
 */
export async function fetchNames({ officeId, authorization, env = process.env, fetchImpl = fetch }) {
  const base = coreBaseUrl(env);
  if (!base) throw unavailable('CORE_URL is not configured');
  const offices = await getJson(`${base}/offices`, authorization, fetchImpl);
  const office = (offices.items ?? []).find((item) => String(item.office_id).toLowerCase() === String(officeId).toLowerCase());
  const services = new Map();
  for (let page = 1; page <= 20; page += 1) {
    const data = await getJson(`${base}/services?page=${page}&page_size=100`, authorization, fetchImpl);
    for (const item of data.items ?? []) {
      if (String(item.office_id).toLowerCase() === String(officeId).toLowerCase()) services.set(item.service_id, item.service_name);
    }
    if (page * 100 >= (data.total ?? 0) || (data.items ?? []).length === 0) break;
  }
  return { officeName: office?.office_name ?? null, services };
}

// Tests replace this (setNamesProvider); production uses fetchNames.
let provider = fetchNames;
export const setNamesProvider = (fn) => { provider = fn ?? fetchNames; };
export const loadNames = (args) => provider(args);
