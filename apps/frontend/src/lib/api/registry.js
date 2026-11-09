// CC043: Student and Alumni Registry as the browser calls it, through the gateway:
// /api/operations/registry/* arrives at the Operations service as /api/registry/*.
//
// BACKEND DEPENDENCY (not implemented in this repository when this file was written): the Operations service has no
// registry routes yet. This file is the frontend side of the boundary, and the only place that knows the request shape:
//   POST /api/operations/registry/imports   multipart/form-data: file (CSV or XLSX), dryRun ("true" | "false")
//   GET  /api/operations/registry/imports   the import history
//   GET  /api/operations/registry/summary   totals by status and by program
// Until those exist the screen shows "not available yet". The answers are read by registry-import.js, which tolerates
// missing fields instead of inventing values.
//
// Demo mode (NEXT_PUBLIC_REGISTRY_DEMO=true, development builds only) swaps in an in-browser stand-in so the screen can be
// shown without the service. It is never used otherwise.
import { apiFetch } from '../auth/session.js';
import { createDemoFetcher } from './registry-demo.js';

export const REGISTRY_API = '/api/operations/registry';
export const REGISTRY_IMPORTS_API = `${REGISTRY_API}/imports`;
export const REGISTRY_SUMMARY_API = `${REGISTRY_API}/summary`;

/** True only in a development build started with NEXT_PUBLIC_REGISTRY_DEMO=true. */
// (Written with literal process.env names so Next.js can put the values into the browser bundle.)
export function isRegistryDemo(flag = process.env.NEXT_PUBLIC_REGISTRY_DEMO, nodeEnv = process.env.NODE_ENV) {
  return flag === 'true' && nodeEnv !== 'production';
}

let demoFetcher = null;
/** The fetcher the screen uses: the signed-in apiFetch, or the demo stand-in in demo mode. */
export function registryFetcher() {
  if (!isRegistryDemo()) return apiFetch;
  demoFetcher ??= createDemoFetcher();
  return demoFetcher;
}

export function buildImportBody(file, dryRun) {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('dryRun', dryRun ? 'true' : 'false');
  return form;
}

// POST /imports with dryRun=true validates only and writes nothing; dryRun=false imports (all or nothing).
export const importRegistry = (file, { dryRun }, fetcher = apiFetch) => fetcher(REGISTRY_IMPORTS_API, { method: 'POST', body: buildImportBody(file, dryRun) });
export const checkRegistryFile = (file, fetcher = apiFetch) => importRegistry(file, { dryRun: true }, fetcher);
export const listRegistryImports = (fetcher = apiFetch) => fetcher(REGISTRY_IMPORTS_API);
export const getRegistrySummary = (fetcher = apiFetch) => fetcher(REGISTRY_SUMMARY_API);
