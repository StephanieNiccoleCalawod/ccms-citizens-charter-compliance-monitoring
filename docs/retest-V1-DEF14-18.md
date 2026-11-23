# Retest V1 / S8-10: DEF-14, DEF-16, DEF-17, DEF-18

**Date:** 2026-11-24. **Commit tested:** `ae40be0` (branch `feat/fe-dashboard-settings-hub-and-fixes`; the fix commits `3f70190`, `8715f10` and `dd9ed36` are all ancestors of it). **Environment:** local dev stack on this machine (not the QA stack of S8-18). **Backend:** read only, nothing changed.

How: the real Super Admin session read the real KPI answers (GET only). The Office Head and Executive screens were then opened with a mocked sign-in, answered with those same real bodies, so the numbers on screen could be compared with the real API. The script is not in the repo. Screenshots: `v1-office-home.png`, `v1-campus-home.png`, `v1-exec-dashboard.png` (scratchpad).

The ticket warned that `dd9ed36` rewrote `KpiHome.js`, `kpi-home.js` and `analytics.js`. So the fixes were checked on the current code, not assumed.

| Defect | Acceptance check | Result | Evidence |
|---|---|---|---|
| DEF-16 | AC1: Office Home tiles equal the API totals | **Pass** | Office with data, half-year: API received 165, on time 126; tiles show 165 and 126 (also late 28, pending 11) |
| DEF-16 | Campus Home tiles equal the API totals | **Pass** | API received 751; tile shows 751 |
| DEF-17 | AC2: Executive Campus Home groups by office, no permission error | **Pass** | Asks `group_by=office` and `group_by=total`, never `staff`; 9 office rows for 9 API groups; no error text on the page |
| DEF-18 | AC3: Executive Dashboard has no failing analytics call | **Pass** | The Dashboard asked for 5 addresses (offices, services, insights overview, late-risk, forecast); all answered 200 on the real services; none of the old sample routes (pulse, trend, risk, heatmap) is called |
| DEF-14 | AC4: complaint email with a named sender reaches the test mailbox | **Not retested (cannot be from FE)** | See below |

## DEF-14: what was checked, and what was not
- Read only: Operations and Oversight mailers contain the DEF-14 handling ("Name <address>" is split so the SMTP envelope takes the bare address). Oversight's `mailer-sender.test.js` passes (2 of 2). Operations' `receipt.test.js` did not finish in 3 minutes here and was stopped; its result is unknown.
- Identity's mailer passes `EMAIL_FROM` straight to nodemailer, which accepts the "Name <address>" form. That answers the BE Dev 2 question from reading the code only; it has not been sent.
- **Not done:** sending a real complaint email to a test mailbox (M6-10). It needs SMTP settings and a test mailbox, which are not on this machine. QA must run it. DEF-14 should stay "Fix committed, retest pending".

## Notes
- Campus Home shows 9 groups while 8 offices are in the catalogue: the orphan office id from before (1 transaction), shown as "Unknown office". A data issue, not part of these defects.
- Office Head was checked with a mocked role, using the data of one real office. A real Office Head account has not been used.
- Suggested status: DEF-16, DEF-17, DEF-18 **Closed** on the local stack at `ae40be0`. Confirm on the QA stack (S8-18) before the release gate.
