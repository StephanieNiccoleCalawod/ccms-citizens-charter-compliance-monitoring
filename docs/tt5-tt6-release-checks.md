# TT5 and TT6 release checks

Local checks on November 11, 2026 used mock receivers and disposable PostgreSQL databases.

| Check | Result |
| --- | --- |
| QA environment generation and isolation | 13 passed |
| Backend regression tests | 79 passed, including 6 for TT6 |
| Runtime database and migration guards | 5 passed |
| Gateway and frontend unit tests | Passed |
| Workspace lint, time checks, and QA script lint | Passed |

TT6 coverage includes a single FMS request on a 401, the visible `KEY_REJECTED` state, Super Admin requeue with the original payload, and bounded retries for other errors. The tests also cover the existing SCMS 401 behavior.

The hosted QA setup still needs its own resources, the approved EB14 fixtures, the hosted test report, and the deployment checklist. Live FMS testing remains pending. This code requires no production schema migration.
