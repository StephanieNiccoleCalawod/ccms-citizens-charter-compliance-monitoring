# S8-46 backend calculation metadata

Scope: Operations and Oversight API support for calculation panels. This change does not implement the frontend controls or satisfy screenshot acceptance checks.

Existing metric values, permissions, filters and response fields are retained. New `calculations` entries contain:

| Field | Meaning |
| --- | --- |
| `what_it_shows` | One sentence describing the figure |
| `how_it_is_computed` | Two to four steps matching the current implementation |
| `data_used.record_count` | Input population for this metric, not the size of an unrelated query result |
| `data_used.period_from`, `period_to` | Inclusive Manila filter dates or observed source dates, as described by `date_basis` |
| `data_used.date_basis`, `source` | Record selection, date field and source |
| `method`, `parameters` | Actual algorithm, fallback and relevant thresholds |
| `last_run_at` | Computation/scoring time; retained when a cached result is served |

Null dates mean unavailable or no source records, never an invented range. Null counts mean no single population (staff attribution is a rule; use the metric counts in that staff group).

## Response coverage

| Endpoint | Metadata location |
| --- | --- |
| `/analytics/kpi`, `/analytics/kpis` | `totals.calculations`, each `groups[].calculations`: received, on-time rate, median, p90, average, pending, outcomes, early margin, queue wait, start flags; staff groups also describe attribution |
| `/analytics/insights/overview` | `calculations`: current/previous KPIs, monthly trend/office heatmap populations, office/service KPI populations, service late-rate cells, today's counts and Charter service samples |
| `/analytics/insights/cell` | `calculations.weekly`, `calculations.late_transactions`; weekly rows already carry completed/late counts; transaction count is before the 50-row display limit |
| `/analytics/forecast`, `/analytics/forecast/retrain` | `calculations.forecast`: saved or fresh history population, actual selected model, range and minimums |
| `/analytics/late-risk` | `calculations.late_risk` for open scored requests; `calculations.context` for office feature history; `model.calculations.training` for global training provenance |
| `/analytics/late-risk/retrain` | `model.calculations.training`, existing training/holdout counts and last attempt time |
| `/ratings/summary` | `calculations.ratings` and each `items[].calculations.ratings` |
| Charter and unusual cases in overview | Each `charter.services[].calculations.charter` and unusual row's same service comparison population |

## Population rules for QA

- On-time rate uses on-time completions plus late completions plus eligible late auto-closures. Completed rows use end date; auto-closures use start date. Cancelled and awaiting-result rows are excluded.
- Median and p90 count only completions in the filter with a computed result and finite elapsed working minutes. P90 uses nearest rank; median averages two middle values for even samples.
- Pending ignores the selected period. Its range is oldest open Manila start date through the scoring date.
- Staff starts/pending belong to the starter, completions to the ender with starter fallback. Executive staff grouping remains forbidden. Metadata contains no staff names or raw training records.
- Forecast history is the original fitted history; a subsequently loaded display history can differ from it. Stale responses preserve the fitted count, dates, model and timestamp. Service eligibility requires both the 40 all-time transaction guard and the 20-working-day history minimum. A `TOO_FEW` response's count is the all-time eligibility count and its history dates are null.
- Late-risk scored count is open requests in the authorized office. Feature history and global training are separate populations. New training attempts save aggregate provenance inside the existing coefficients JSON; no schema migration is required. Old runs' unavailable dates stay null. Old score caches are refreshed when possible; stale legacy caches identify their unavailable range explicitly.
- Unusual cases compare against usable completions in the same office and service and selected completion period. The sample count is the service population, not the number flagged. Eligibility requires 20 completions; the fence is strictly Q3 + 3 × IQR with interpolated quartiles.
- Ratings count submitted stars, excluding unused codes. Service averages round to two decimals. The existing total average is the count-weighted mean of those rounded service averages; the explanation states that exact rule.

## Verification

Run the focused tests without a database:

```sh
node --test apps/operations-service/test/s8-46-calculations.test.js apps/oversight-service/test/s8-46-calculations.test.js
```

They check metric-specific populations, office/service filters, Manila boundaries, starter/ender attribution, Executive privacy, cached/stale scoring provenance, forecast formatting, ratings scope and unusual-case sample counts. Hosted QA record reconciliation and frontend panel screenshots remain separate checks; they have not been performed by these tests.

Local verification on 2026-11-23, based on deployment commit `bd13769`:

- Seven S8-46 tests plus 26 forecast-engine regression tests: 33 passed.
- Existing KPI, period, access, Charter, heatmap and sentence tests (database suites excluded by name filter): 33 passed.
- Existing pure late-risk model tests: 3 passed.
- Operations, Oversight and shared-package lint: zero errors. Oversight reports one existing unused-disable warning in `modules/complaints/complaints.js`.
- Changed-source Manila/UTC time-usage check: no violations. `git diff --check`: clean.

The implementation is local; no deployment, production training, migration or hosted QA run was performed. Existing unrelated workspace edits were preserved.
