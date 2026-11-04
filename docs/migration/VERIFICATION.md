# Verification results — 4 November 2026

Verified on Windows with Node.js 26.1.0, npm 11.14.1 and disposable PostgreSQL 16.14 servers. CI targets Node.js 22; Node 22 and the remote GitHub workflow were not executed locally.

## Completed checks

| Check | Result |
| --- | --- |
| Dependency installation | Passed; one root lockfile and seven local workspace links |
| Framework update | All six applications use Next.js and eslint-config-next 16.4.5; one hoisted Next.js version |
| Workspace dependency tree | `npm ls --workspaces --depth=0` passed |
| Shared exports | Passed, including roles, navigation and testing subpaths |
| Lint | Passed after the upgrade; edited job tests and Operations fixtures were also linted after final edits |
| Time checks | Passed for every applicable workspace |
| Production builds | All six passed on Next.js 16.4.5 |
| Root `npm test` | Passed: 1,746 test executions, zero failures, zero skips |
| Runtime safety | Four root tests verify synchronization and extension installation remain disabled even with environment opt-in; shared default/consolidation tests also passed |
| Root `npm start` | All six processes launched on original ports; UI, rewrite, Gateway, Identity and Core HTTP checks returned 200 with database access deliberately disabled for this check |
| Isolated schema setup | Original sync scripts succeeded for four separate databases with distinct owners; Oversight runtime used its restricted writer role |
| Database-backed startup smoke | All six checks returned 200; frontend rewrite reached Gateway; unauthenticated protected request returned 401 |
| Local Compose | Configuration validation passed; the four default-port Compose servers were not started |
| CI YAML | Parsed successfully; checks only, no deployment job |
| Source preservation | Initial migration preserved source; subsequent requested cleanup removed five unreferenced files, recorded in `cleanup.json` |

Builds used a loopback Gateway rewrite and disabled database synchronization. Suites used the disposable test server at `127.0.0.1:55439`; schema/startup checks used a separate disposable server at `127.0.0.1:55449`. Existing environment files and database connections were not used by these database checks. Test application processes were stopped afterward.

## Test counts

| Workspace / phase | Passed |
| --- | ---: |
| Shared | 48 |
| Gateway | 43 |
| Core | 453 |
| Core engine in UTC | 103 |
| Core engine in America/Los_Angeles | 103 |
| Frontend unit/source checks | 691 |
| Identity | 83 |
| Operations | 192 |
| Oversight | 26 |
| Root runtime safety | 4 |
| Total executions | 1,746 |

The total includes 206 timezone reruns, not 1,746 distinct cases. Machine-readable results are in `test-results.json` and `startup-results.json`.

## Resolved findings

- Archived Next.js 16.4.0 builds compiled but some stopped at a security notice. The user authorized the 16.4.5 upgrade; all new builds exit successfully and the new audit has no Next.js entry.
- Three job tests expected Vercel manifests. They now check the manual local endpoint inventory and HTTP exports. Original cron expressions remain reference data in `../local-jobs.json`; no scheduling or deployment was configured.
- Operations naming tests now validate the root lockfile workspace entry/link instead of a nested lockfile.
- An original real-HTTP test's 80ms deadline expired before loopback requests reliably arrived on this host. Its test-only deadline is now one second; it still requires two attempts and timeout periods. The application's five-second default is unchanged.
- An existing fake Core teardown race left a worker alive after database cleanup. Test servers now stop listening before closing sockets, following [Node.js HTTP guidance](https://nodejs.org/api/http.html#servercloseallconnections). The complete root test command then passed.
- Isolated Oversight setup initially lacked the administrative CREATEDB attribute required for role hardening. The disposable fixture and documentation were corrected; application grants and runtime restrictions were preserved.
- A cold smoke request exceeded its initial 30-second test deadline during concurrent work. Retrying with a 120-second cold-start deadline passed every endpoint; application timeouts were not changed for this check.

## Remaining issues and untested behavior

`npm audit --omit=dev` exits **1** with **four inherited vulnerable dependency entries**: one high (Nodemailer) and three moderate (glob, minimatch and TypeORM). There are **zero critical entries** after the Next.js update. Exact instances and advisory links are in `dependency-audit.json`. Other archive dependency versions were retained; major mail/ORM upgrades were outside this migration. The strict production-audit CI step remains red until these advisories are resolved.

Real browser end-to-end business workflows were **not executed**. Frontend tests include extensive source checks. Real SMTP/HTTP email delivery, external calendar receivers and production integrations were not exercised; the local fake-server tests passed. No production database was connected to or modified.

Existing `.env.local` files are preserved and excluded from Git and the ZIP. No Git repository, remote, commit, push, deployment provider, production domain or deployment pipeline was created or configured.

## Subsequent unused-file cleanup

At the user’s request, a reference graph and exact-name search identified four unused internal export barrels and the unused PageContainer component. Those five source files and 24 temporary verification files (including the cleanup run’s own logs) were removed. Routes, public shared exports, migrations, tests, seed history, environment files and assets were retained. Post-cleanup lint, all six application builds and all 691 frontend tests passed; final outcomes are recorded in `cleanup.json`. Backend/database suites were not rerun for this deletion-only cleanup. The 1,746-test result above belongs to the completed migration baseline.
