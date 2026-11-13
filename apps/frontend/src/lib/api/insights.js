// Insights (CC053 / CC054), through the gateway (/api/logs/* reaches Oversight) and Operations (/api/operations/*), with the signed-in token.
//   GET /api/logs/analytics/insights/overview?period=&office_id=   pulse, heatmap, sentences, charter check, about
//   GET /api/logs/analytics/insights/cell?office_id=&service_id=   weekly trend and late transactions of one heatmap cell
// Late-risk and forecast live in Operations and need one office; each call can fail on its own and the page shows "not available".
import { apiFetch } from '../auth/session.js';
import { toQuery } from './client.js';

export const INSIGHTS_API = '/api/logs/analytics/insights';
export const OPERATIONS_ANALYTICS_API = '/api/operations/analytics';

export const getInsightsOverview = ({ period, officeId } = {}, fetcher = apiFetch) =>
  fetcher(`${INSIGHTS_API}/overview${toQuery({ period, office_id: officeId })}`);
export const getInsightsCell = ({ officeId, serviceId, period } = {}, fetcher = apiFetch) =>
  fetcher(`${INSIGHTS_API}/cell${toQuery({ office_id: officeId, service_id: serviceId, period })}`);
export const getOfficeLateRisk = (officeId, fetcher = apiFetch) => fetcher(`${OPERATIONS_ANALYTICS_API}/late-risk${toQuery({ officeId })}`);
export const getOfficeForecast = (officeId, fetcher = apiFetch) => fetcher(`${OPERATIONS_ANALYTICS_API}/forecast${toQuery({ officeId })}`);
export const retrainOfficeModels = (officeId, fetcher = apiFetch) =>
  Promise.allSettled([
    fetcher(`${OPERATIONS_ANALYTICS_API}/late-risk/retrain`, { method: 'POST', body: { officeId } }),
    fetcher(`${OPERATIONS_ANALYTICS_API}/forecast/retrain`, { method: 'POST', body: { officeId } }),
  ]);
