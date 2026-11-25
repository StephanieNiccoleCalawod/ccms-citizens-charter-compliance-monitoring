# S8-50: BE Dev 1 training exclusions

## Production follow-up, November 24, 2026

User supplied a successful database integration run (8 passed, 0 failed) and full operations-service lint completion without errors. Applied `S850TrainingExclusions1795478400000` to `ccms_operations` in project `morning-wind-47114114`, production branch `br-autumn-heart-b3rh3v8j`. Executed the exact repository up-migration SQL and inserted TypeORM ledger entry 17 in one transaction with the repository migration advisory lock keys (43436, 900). A separate post-commit query confirmed the nullable integer column, non-negative CHECK constraint, and ledger entry. All 531 existing forecast runs were retained with NULL exclusion counts. Evidence: `S8-50-production-migration-20261124.json`. Code push/deployment and model refresh remain pending. The original implementation notes below describe the earlier local-only state; this follow-up supersedes their pending migration, lint and database-check status.

Implemented locally November 24, 2026 (Asia/Manila). No production database changes or deployment performed. BE Dev 2 detection/notifications and frontend work are outside this change.

## Behavior

Both training paths exclude completed slow cases using the existing CC054 definition: group by office and service, require at least 20 usable completions, interpolate Q1/Q3, and exclude elapsed working minutes strictly greater than Q3 + 3 × (Q3 − Q1). Usable means completed with elapsed minutes, variance minutes and computed compliance. Equality at the fence is retained, including zero IQR. Missing results are not treated as outliers.

Training uses all usable completions available by the run's as-of instant to establish each office/service fence. This population is explicit: the Oversight screen may use a narrower selected reporting period and can therefore produce different fences. No shared persisted BE Dev 2 flag or detection-period contract exists in the inspected code. Align the selected detection population with BE Dev 2 when integrating D-AC-3; this implementation matches the formula, minimum sample and grouping, not an unspecified reporting date filter.

| Path | Exclusion and saved evidence |
| --- | --- |
| Forecast | SQL removes slow cases from daily counts before fitting. Working dates remain, including zero-request days. `forecast_runs.excluded_transaction_count` records exclusions in the actual selected working-day window. API exposes `excludedTransactionCount`. |
| Late-risk | Slow cases are omitted from sampled training/holdout rows and training pace/load context. Existing `late_risk_runs.excluded_rows` counts the union of slow cases and previously excluded unknown-hold-timing rows without double counting. `coefficients.training_data.excluded_slow_cases` records the slow-case subset. |
| Reports | No transaction is deleted, updated, or removed from reporting queries. |

Service forecast all-time eligibility remains the existing transaction count check. Filtering applies to model inputs. Late-risk scoring of current open transactions is unchanged; the exclusion is in training. Existing stored models/forecasts are not retroactively rewritten.

## Migration and rollout

New migration: `S850TrainingExclusions1795478400000`. Adds a nullable non-negative integer `forecast_runs.excluded_transaction_count`. Older runs remain NULL (unknown), rather than claiming an exclusion count of zero. New runs explicitly save a count, including zero. The local/test after-sync setup mirrors the added column. Down migration refuses to remove saved exclusion evidence from a populated forecast table without the repository's explicit data-loss override.

Apply the migration **before deploying this code**, then run/retrain forecasts and late-risk on the target data so newly filtered models replace existing results. Existing cached/stored results can remain in use until refreshed/retrained. No migration has been applied here.

From `apps/operations-service`, using the established target environment:

```powershell
npm run migrate:run
```

## Verification

- **16 regression tests passed**: S8-46 calculations, S8-47 full history, S8-48 forecast response, and S8-49 main reasons.
- **7 tests passed**: four new S8-50 checks and three S8-09 model-feature privacy checks. Fixtures cover per-office/service isolation, minimum sample, strict fence/zero IQR, missing results, late-risk training population 21 → 20 and excluded count 1, forecast window exclusion counts, and migration shape.
- These passing tests use injected database/calendar adapters; they do not validate execution of the new SQL against PostgreSQL.
- Tracked diff whitespace and the database-test syntax check passed. Targeted ESLint did not finish after several minutes and was stopped; lint is not recorded as passing.
- Added `s8-50-training-exclusions-db.test.js` for actual SQL aggregation, run persistence, and report row retention. Database-backed verification remains pending: this session previously received `EACCES` for PostgreSQL on `127.0.0.1:55432` and Docker API access denied. No production database was used as a substitute test target.

Run with the existing test PostgreSQL server available:

```powershell
node --test apps/operations-service/test/s8-50-training-exclusions-db.test.js apps/operations-service/test/late-risk.test.js
```

This is a local BE Dev 1 implementation with database integration and rollout still pending. It does not mark the entire S8-50 item complete.
