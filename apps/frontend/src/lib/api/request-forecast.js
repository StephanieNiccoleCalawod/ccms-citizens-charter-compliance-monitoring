// CC038 Request Volume Forecast — data access.
// All forecast reads go through this file. The endpoint is /api/operations/analytics/forecast
// on the operations-service, reached through the API gateway's /api/operations route.
import { apiFetch } from '../auth/session.js';
import { OFFICES_API, SERVICES_API } from './catalogue.js';
import { toQuery } from './client.js';

export const FORECAST_BASE = '/api/operations/analytics/forecast';

/**
 * Fetch the latest forecast for an office (and optionally a service).
 * @param {{ officeId: string, serviceId?: string|null }} scope
 */
export function getRequestForecast({ officeId, serviceId = null }, fetcher = apiFetch) {
  const q = toQuery({ officeId, serviceId: serviceId || undefined });
  return fetcher(`${FORECAST_BASE}${q}`);
}

/**
 * Trigger a manual retrain (Super Admin only).
 * @param {{ officeId: string, serviceId?: string|null }} scope
 */
export function retrainRequestForecast({ officeId, serviceId = null }, fetcher = apiFetch) {
  return fetcher(`${FORECAST_BASE}/retrain`, {
    method: 'POST',
    body: JSON.stringify({ officeId, serviceId: serviceId || null }),
  });
}

/** Fetch the active offices list for the forecast office selector. */
export function getForecastOffices(fetcher = apiFetch) {
  return fetcher(OFFICES_API);
}

/** Fetch the active services list for the forecast service selector. */
export function getForecastServices(fetcher = apiFetch) {
  return fetcher(SERVICES_API);
}
