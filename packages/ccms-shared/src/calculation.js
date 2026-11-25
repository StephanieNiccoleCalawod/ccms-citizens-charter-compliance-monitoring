// S8-46: aggregate-only provenance for calculation panels. Never pass raw records or people here.
export function calculation({ shows, steps, count, from = null, to = null, basis, source,
  method, at, parameters = {} }) {
  return {
    what_it_shows: shows,
    how_it_is_computed: steps,
    data_used: { record_count: count, period_from: from, period_to: to, date_basis: basis, source },
    method,
    last_run_at: at != null ? new Date(at).toISOString() : null,
    parameters,
  };
}
