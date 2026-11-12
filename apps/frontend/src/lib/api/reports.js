// Office reports (CC029 / CC030 / CC031) as the browser calls them, through the gateway (/api/logs/* reaches Oversight):
//   POST /api/logs/reports                       { officeId, periodType, from?, to?, date? } -> the draft (created or refreshed)
//   GET  /api/logs/reports?office_id=&period_type=&status=&page=&page_size=   the list, without figures
//   GET  /api/logs/reports/:id                   one report with its figures
//   POST /api/logs/reports/:id/publish           { confirm: true } -> published (409 REPORT_NOT_A_DRAFT when it already is)
//   POST /api/logs/reports/:id/new-version       { reason } -> draft n+1 (201)
//   GET  /api/logs/reports/:id/export.csv        UTF-8 with BOM, MM/DD/YYYY
// Who may do what is decided by the server; the screen only follows it.
import { apiFetch, getAccessToken } from '../auth/session.js';
import { toQuery } from './client.js';

export const REPORTS_API = '/api/logs/reports';
const one = (id) => `${REPORTS_API}/${encodeURIComponent(id)}`;

export const generateReport = (body, fetcher = apiFetch) => fetcher(REPORTS_API, { method: 'POST', body });
export const listReports = ({ officeId, periodType, status, page, pageSize } = {}, fetcher = apiFetch) =>
  fetcher(`${REPORTS_API}${toQuery({ office_id: officeId, period_type: periodType, status, page, page_size: pageSize })}`);
export const getReport = (id, fetcher = apiFetch) => fetcher(one(id));
export const publishReport = (id, fetcher = apiFetch) => fetcher(`${one(id)}/publish`, { method: 'POST', body: { confirm: true } });
export const startNewVersion = (id, reason, fetcher = apiFetch) => fetcher(`${one(id)}/new-version`, { method: 'POST', body: { reason } });

/** The CSV as a Blob plus the server's file name; sent with the bearer token (a plain link could not carry it). */
export async function downloadReportCsv(id, { fetchImpl = fetch, token } = {}) {
  const bearer = token ?? (await getAccessToken());
  const response = await fetchImpl(`${one(id)}/export.csv`, { credentials: 'same-origin', headers: { authorization: `Bearer ${bearer}` } });
  if (!response.ok) throw new Error('The CSV could not be downloaded right now. Please try again.');
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'report.csv';
  return { blob: await response.blob(), filename };
}
