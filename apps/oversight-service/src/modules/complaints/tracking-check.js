import { AppError, serviceApiBase } from 'ccms-shared';

// S8-56: does this tracking number belong to a real transaction? Asked of Operations with the shared service key (Oversight keeps no
// transactions). Returns { found: false } or { found: true, office_id, office_name, service_name, date } (date = the Manila day it started).
// Operations or the key unavailable is a 503, never a guess, so a complaint is never tied to a number nobody confirmed.
const UNAVAILABLE = 'The tracking number cannot be checked right now. Please try again in a few minutes.';

const manilaDay = (iso) => new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);

export async function checkTrackingNumber(trackingNo, { env = process.env, fetchImpl = fetch } = {}) {
  const value = typeof trackingNo === 'string' ? trackingNo.trim() : '';
  if (!value) return { found: false };
  const base = serviceApiBase(env.OPERATIONS_SERVICE_URL);
  if (!base || !env.SERVICE_KEY) throw new AppError(503, 'OPERATIONS_UNAVAILABLE', UNAVAILABLE);
  let response;
  try {
    response = await fetchImpl(`${base}/internal/tracking-check?tracking_no=${encodeURIComponent(value)}`, {
      headers: { accept: 'application/json', 'x-service-key': env.SERVICE_KEY },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new AppError(503, 'OPERATIONS_UNAVAILABLE', UNAVAILABLE);
  }
  if (!response.ok) throw new AppError(503, 'OPERATIONS_UNAVAILABLE', UNAVAILABLE);
  const body = await response.json().catch(() => null);
  if (!body || body.found !== true) return { found: false };
  return { found: true, office_id: String(body.office_id ?? '').toLowerCase(), office_name: body.office_name ?? null, service_name: body.service_name ?? null, date: body.started_at ? manilaDay(body.started_at) : null };
}

/** Whether a complaint must carry a confirmed tracking number (D-AC-1 pending, so off unless COMPLAINT_REQUIRE_TRACKING=true). */
export const trackingRequired = (env = process.env) => env.COMPLAINT_REQUIRE_TRACKING === 'true';
