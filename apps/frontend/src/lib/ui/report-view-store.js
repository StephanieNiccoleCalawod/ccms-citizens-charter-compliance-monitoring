// Carries the report just generated or opened on the Reports page to the dedicated report view (/reports/view) -
// a plain module variable, the same pattern AppShell uses for activeSessionUser, so the handoff needs no server
// round trip and nothing is persisted once the tab is closed or reloaded (a hard refresh on /reports/view has
// nothing to show; the page sends the person back to /reports instead of trying to re-fetch a query it never had).
let current = null;

export function setViewedReport(entry) {
  current = entry;
}

export function getViewedReport() {
  return current;
}
