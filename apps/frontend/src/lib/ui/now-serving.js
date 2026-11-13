// "Now serving" screen rules (CC059). Pure, so they are tested without a browser.
export const REFRESH_MS = 5000; // the screen asks every 5 seconds (AC1)
export const STALE_AFTER_FAILURES = 3; // after three failed reads in a row the numbers are marked as possibly old

/** What the screen holds after each read. A failed read keeps the last numbers (a TV should not go blank on a hiccup). */
export const INITIAL = Object.freeze({ status: 'loading', view: null, failures: 0, updatedAt: null });
export const succeeded = (view, nowMs) => ({ status: 'ready', view: { current: view?.current ?? null, next: Array.isArray(view?.next) ? view.next.slice(0, 3) : [] }, failures: 0, updatedAt: nowMs });
export const failed = (state) => ({ ...state, status: state.view ? state.status : 'error', failures: state.failures + 1 });
export const isStale = (state) => Boolean(state.view) && state.failures >= STALE_AFTER_FAILURES;
export const headline = (view) => (view?.current ? view.current : 'No ticket is being served');
