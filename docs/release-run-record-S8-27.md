# Release run record (S8-27): lint, unit, integration, e2e, build

**Date:** 2026-11-24. **SHA:** `01e63ae` (branch `feat/fe-dashboard-settings-hub-and-fixes`, clean working tree when the run started). **Where:** this developer machine, Node 24, not CI and not the hosted site. **Database for the DB tests:** a throwaway `postgres:16-alpine` on port 55432 with the same user, password and port as the CI service in `.github/workflows/ci.yml`, removed afterwards. **Backend code was not changed.**

The release SHA is not frozen (S8-28), so this is a run on the current head, not on a frozen release. It must be repeated on the frozen SHA.

## The CI failure at f0b936e (named first, AC1)
- **What is known:** `f0b936e` ("Allow selecting the month for monthly reports", 2026-11-20) changed only two front-end files (`ReportsPage.js`, `reports.test.js`). Both it and `ad29ea7` (the run before, which passed) are ancestors of `01e63ae`, and both come after `dd9ed36`, so the local clone has them.
- **What was done:** the front-end unit tests were run at `f0b936e` in a temporary copy: **1,121 of 1,121 pass**. So the failing assertion is not in the front-end unit tests of that commit.
- **What is not known:** which assertion failed. The GitHub log cannot be read from here (not signed in). The other steps of `npm test` (back-end suites, safety, integration) were not run at that SHA.
- **Reading:** at the current head the same `npm test` passes on every suite (below) when a Postgres is available on port 55432. Without it, 8 of the 50 safety tests fail with `ECONNREFUSED 127.0.0.1:55432`. A failure of that kind (the database not ready, or a flaky run) is a possible cause, but it is **not confirmed**.
- **Owner and decision needed:** whoever has the GitHub Actions log of the `f0b936e` run (BE Dev 1 or the repository owner) names the failing test, or reruns that commit. FE has no failing test to fix.

## Results at `01e63ae`
| Step | Command | Result |
|---|---|---|
| Lint | `npm run lint` (all workspaces) | 0 errors; 3 warnings (2 in frontend, 1 in oversight), all unused-directive or aria notes that were there before |
| Time check | `npm run check:time` | pass |
| Unit and service tests | `npm test` | shared 95, api-gateway 59, core 595 (+133 timezone), frontend 1,306, identity 212, operations 462, oversight 175: **all pass, 0 fail** |
| Safety | `npm run test:safety` | 50 of 50 pass |
| Integration | `npm run test:integration` | 10 pass, 1 skipped, 0 fail |
| Whole `npm test` | one command | exit 0, 4 min 8 s |
| Frontend e2e | `node tests/e2e/analytics-dashboards.cjs` against the dev server | **Does not pass** (see below) |
| Build | `npm run build` | **Not run** (see below) |
| Dependency audit | `npm audit --omit=dev` | Not run |

## The front-end e2e (owner: FE, decision needed)
- Run as a whole it stops at its 8th check: 7 pass, 1 fails, then the script aborts on a missing element.
- **Stale after the redesign (FE owner):** the Service Charter Compliance steps expect the old service-card layout (`insights-heatmap`, filters, cell detail). That tab now shows the office performance view, so the script must be rewritten for it. This is a test that was not updated, not a user-facing bug.
- **Call counts fail only on the development server:** with the first block skipped, the other blocks give 37 pass, 2 fail. In both, every real condition is true and only a request count is 2 instead of 1 (office forecast and permission switches); the dashboard overview request is also sent twice, 3 ms apart. React's strict mode runs effects twice in development, which does this. A production build should not. **Not proven**, because the build below was not run.
- **Decision:** rewrite the Charter-tab steps (FE), and run the script against a production build (`next build` and `next start`) to settle the counts.

## Why the build was not run
`next build` writes to the same `.next` folder as the running dev server. A build in a clean copy of the commit failed to find `next` (the copy shares `node_modules` through a link, which the bundler does not follow), and the QA dist-folder switch needs a QA target set id that is not set here. Build on a clean checkout with its own `npm ci`, as CI does.

## Blocked, not passed (AC3)
- Hosted smoke and the four chains on the hosted release (S8-22): no approved demo accounts or PM approval (D8-11).
- Anything on the QA stack (S8-18) and the release deployment.
- `npm audit`, build, and the CI run itself.
