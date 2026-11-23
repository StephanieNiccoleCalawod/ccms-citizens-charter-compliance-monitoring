# All open items in one place (errors, questions, needs)

**Date:** 2026-11-24. **Commit:** `a1fe2f1` (branch `feat/fe-dashboard-settings-hub-and-fixes`, nothing pushed). Front end only; the backend was read only.

This file collects what is still open. Details and the answer boxes are in the files it points to: `questions-for-pm.md` (PM questions with **Answer:** lines), `needs-clarification.md`, `not-done-yet.md`, and one note per ticket.

How to use it: **Part 1** errors and failures that are still true. **Part 2** questions for the PM. **Part 3** asks for QA. **Part 4** asks for the backend team. **Part 5** accessibility and design. **Part 6** work not done and process.

---

## Part 1. Errors and failures still open

| # | What | Where it was seen | Owner | State |
|---|---|---|---|---|
| E1 | CI run `f0b936e` failed at `npm test`; the failing test is not named. FE unit tests pass at that commit (1,121). | `release-run-record-S8-27.md` | BE Dev 1 / repo owner (needs the GitHub log) | Open |
| E2 | Browser e2e `tests/e2e/analytics-dashboards.cjs` does not pass. Its Service Charter Compliance steps describe the layout from before the office performance redesign. | S8-27 run | FE | Open: needs a rewrite |
| E3 | Same e2e: request counts were 2 instead of 1 on the dev server. Cause: React runs effects twice in development. | S8-27 run | FE | **Resolved**: on a production build the other blocks give 39 pass, 0 fail, and the duplicate-request check passes |
| E4 | `next build` overwrites the `.next` folder of the running dev server. | S8-27 | FE | **Mostly resolved**: `next build --webpack` in a clean copy passes. The plain `npm run build` (default bundler) on a clean `npm ci` is still to run, as CI does |
| E5 | Safety tests fail without a Postgres on port 55432 (8 of 50, `ECONNREFUSED`). With it, all pass. | S8-27 | Environment | Known; CI provides the database |
| E6 | Operations `receipt.test.js` did not finish in 3 minutes when run alone, without the database. It passes inside the full run with Postgres. | V1 | BE | Explained, please confirm |
| E7 | DEF-14: a complaint email with a named sender was not sent to a test mailbox. | `retest-V1-DEF14-18.md` | QA | Not run (needs SMTP and a mailbox) |
| E8 | Account menu in the header: axe still reports "label in name" at 640 px and wider, even when the name equals the visible text. | S8-38 | Accessibility check by a person | Open |
| E9 | "By staff member" says "Staff member" for every row of an Office Head. Cause is the backend (accounts list is Super Admin only; KPI rows carry no names). The screen now explains it. | S8-17 #3 | BE + PM | Explained, not fixed |
| E10 | One office id has a transaction but is not in the catalogue: "Unknown office" in the office performance view. | S8-25 | BE / data | Open |
| E11 | One forecast run is recorded as SUCCESS with 0 transactions and 0.00 error. | S8-25 | BE | Open |
| E12 | Late-risk items have no limit, elapsed or overdue minutes, so the screen says "Overdue" without hours. | S8-25 | BE | Open |
| E13 | The older Identity database on port 5433 (4 accounts) still has `employee_no` NOT NULL. The stack's own database (port 15433) is fine. | V2 | BE | Open for the QA/target database (S8-19) |

Fixed in this round (for the record): queue page crash on a reply that is not a board; no h1 on the directory; Attach receipt shown on cancelled transactions; long ticket numbers running off the screen at 360 px; inactive offices unlabelled in Reports and Complaints filters; muted text contrast; small targets; tab panel focus ring; complaint reference error not announced.

---

## Part 2. Questions for the PM

**Earlier questions (full text and answer boxes in `questions-for-pm.md`):**
1. Session limits: are the numbers approved, what for Clerk, can a Super Admin change them (S8-33/34, D8-04, D8-17, D8-05)?
2. Night school hours: real hours, days and offices; does an office cross midnight (S8-44, D8-23)?
3. Lunch break and the Charter clock: is the wording the approved policy (S8-43, D8-22)?
4. Glossary: "Start transaction", "On hold", "acknowledgement" spelling, "Access pending", one outage sentence, and what SCMS stands for (S8-35, D8-16).
5. Settings hub and menu: keep Holidays and Accounts in the hub, redirect the old address, Settings in every role's menu, the landing-page-first rule, the three walkthrough tasks (S8-13/14/36, D8-20).
6. Late-risk Escalate: a real audited escalation, or is "Review" enough? (S8-25)
7. Is "Overdue" without the hours acceptable for the defense? (S8-25)
8. Targets and refresh: 95% or 100%? live-refresh rule? (R-05, R-08)
9. Model figures: may they be quoted? which data to train on? (D8-08, D8-09, D-08)
10. Late-rate thresholds 10%, 20%, fewer than 5 completed: the business rule?
11. Days or minutes on the alert cards.
12. The orphan office id and the 0-transaction forecast run.
13. Test accounts for Office Head, Office Staff and Executive, and permission for one change that is put back (S8-15).
14. Who runs the walkthrough with real staff, and when (S8-36).
15. Email and notification status screen (S8-31): still planned?
16. When to push and merge the branch into `codebase-for-deployment`; change the shared password that was pasted in chat.

**New questions from the latest tickets:**

| # | Ticket | Question | Blocked until answered | Today |
|---|---|---|---|---|
| N1 | S8-16 (D8-12) | Which contact route is approved for the public footer? | Contact link | None shown |
| N2 | S8-16 | Who is the approved rights holder for the © line? | Final copyright line | Uses "PUP Quezon City" |
| N3 | S8-16 | Will Privacy and Accessibility pages exist, and who writes them? | Those footer links | No links |
| N4 | S8-16 | The ticket says "track a transaction" but there is no public page for it. Is "Check a complaint" enough, or is a public tracking page wanted? | Footer link list | Links to Check a complaint |
| N5 | V3 #2 | Staff creation password with Clerk sign-in on: is "Initial password (optional)" the decided behaviour (Clerk review §4.3)? | Closing #2 as "changed by decision" | Optional |
| N6 | V3 #10 | Is "This was already done." the approved wording for a late entry (replaces "backdated")? | Closing #10 | New wording live |
| N7 | V3 #8 | Keep Edit inside the row menu ("Actions for ..."), or add a visible Edit button? | Closing #8 | Row menu only |
| N8 | S8-41 | Who runs the real walkthrough with an Office Staff, Office Head, Super Admin and citizen, and when? | AC1 with real people | Scripted only |
| N9 | S8-22 (D8-11) | Approve protected demo accounts and hosted actions; give the hosted URL and the deployed SHA. | The four chains on the hosted release | Blocked, no safe environment |
| N10 | S8-28 (D8-15) | Which SHA is frozen, and the freeze date? | Freeze record; a run on the frozen SHA | Not frozen |
| N11 | S8-28 | Who records the backup demo video, on which SHA, and where is the file kept? | AC2 (demo runs twice the same way) | Not recorded |
| N12 | S8-28 | The master plan §15 manifest is not in the repository. Please provide it. | A complete evidence manifest | Manifest lists only what exists |
| N13 | S8-28 | How is the hosted release rolled back (previous deployment, database backup)? | Rollback note | None |
| N14 | S8-27 | OK for FE to rewrite the Charter-tab steps of the e2e and run it against a production build? | E2, E3 | Waiting |

---

## Part 3. For QA

| # | Ticket | Ask |
|---|---|---|
| Q1 | V3 | Send the DEFECTS rows for #6, #7 and #9 (the ticket does not name them). |
| Q2 | V1 | Run M6-10: a complaint email with a named sender to a test mailbox (E7). |
| Q3 | V1, V2 | Repeat DEF-16, 17, 18, 19, 20 on the QA stack (S8-18) with real Office Head and Executive accounts. |
| Q4 | V2 | Apply the DEF-19 migration on the QA/target Identity database first (S8-19). |
| Q5 | V2 | Do the real saves: two blank employee numbers, a real duplicate, turning "applies to" off after removing its entries. |
| Q6 | V3 #3, #12 | Use a real inactive office, and save a service with required documents. |
| Q7 | S8-41 | Provide a test office for Start, Hold/Resume and Complete end to end. |
| Q8 | S8-17 | Recheck the required-documents ticks and the cancelled-receipt message at 360 and 768 px (done at 1280 only). |
| Q9 | S8-28 | Read the user manual draft against the released version; finalize the RTM and test plan. |
| Q10 | S8-22 | File the dated screenshot of the October report on the deployed site, with the deployed commit. |

---

## Part 4. For the backend team (asked, not changed)

| # | Ask |
|---|---|
| B1 | Name the failing test in the `f0b936e` CI run, or rerun it (E1). |
| B2 | Give an Office Head the names of their own office's staff (a names list limited to the office, or a name inside the per-staff KPI rows) (E9). |
| B3 | Send overdue minutes (`overdue_working_minutes`, or `limit_minutes` with `elapsed_working_minutes`) for late-risk items (E12). |
| B4 | There is no escalation endpoint; say if one is planned (PM question 6). |
| B5 | Confirm that a 503 never writes anything (calendar, catalogue, receipt storage). |
| B6 | Lunch fixtures at 11:59, 12:00 and 13:00 Asia/Manila, lunch on and off (S8-43). |
| B7 | Clerk sign-in has no session limits; the browser cannot read its own role's limits (policy endpoint is Super Admin only). |
| B8 | One transaction-settings change, to confirm the `TRANSACTION_SETTINGS_UPDATED` audit row has been seen in real data. |
| B9 | The orphan office id `2b696c02-5adc-43d5-8977-a2818ed94552` and the 0-transaction forecast run (E10, E11). |
| B10 | `calculations` (S8-46) and `main_reason_code` (S8-49) are returned but no screen uses them; say if an explanation panel is wanted. |
| B11 | Confirm Core ignores removed calendar entries when turning "applies to" off (fix `08aa866`), and that Identity accepts two blank employee numbers and refuses a real duplicate (fix `3bb969e`). |
| B12 | Confirm the Identity mailer sends the bare address for password reset (read from the code only). |
| B13 | Operations `receipt.test.js` (E6): confirm it passes on your machine alone. |

---

## Part 5. Accessibility and design

| # | Ask |
|---|---|
| A1 | A person with a screen reader checks the account menu in the header (E8). |
| A2 | Check the print slip, the queue countdown message, and Office Head and Staff pages with real accounts (not covered by the S8-38 audit). |
| A3 | The S8-38 checklist is a checklist, not a WCAG certification. |

---

## Part 6. Work not done, and process

- **Not done by FE:** hosted run of the four chains (S8-22, blocked), freeze record, backup demo video, rollback note, final RTM and test plan, `next build` and `npm audit`, the e2e rewrite, the real saves listed in Part 3, the walkthrough with people.
- **Drafts only:** `user-manual-draft.md`, `known-limitations.md`, `evidence-manifest.md`.
- **Process:** nothing is pushed. Two backend commits (S8-46, S8-49) wait on the remote branch; they do not conflict with the FE work. The shared password pasted in chat must be changed. A backup of the removed session-policy front end is in `D:\integ capstone 1111\session-policy-fe-backup\`.

## Where each detail lives
`questions-for-pm.md` (PM, with answer boxes) · `needs-clarification.md` (QA, BE, accessibility) · `not-done-yet.md` (what was left) · `release-run-record-S8-27.md` · `retest-V1-DEF14-18.md` · `retest-V2-DEF19-20.md` · `retriage-older-defects-S8-12.md` · `recheck-V4-S8-17.md` · `walkthrough-log-S8-41.md` · `accessibility-checklist-S8-38.md` · `evidence-manifest.md` · `known-limitations.md`.

---

## Added 2026-11-24 (before push): the remote branch fails its own tests

`origin/codebase-for-deployment` is at `5b28154` (S8-46, S8-49, S8-50). It has 3 commits our branch does not have; our branch has 8 that it does not have. No file is changed by both sides, and the trial merge is clean.

| # | What | Evidence | Owner |
|---|---|---|---|
| E14 | **Operations: 3 tests fail on the remote branch alone** (474 of 477 pass): "S8-42 recipients" and "S8-42 re-polling and content" (late-risk notice), "is empty with no ratings, and filters by date" (ratings summary now carries `calculations`), and "Office Staff get only their own transactions...". | Same 3 fail on a fresh database, on `5b28154` with none of our commits. | BE Dev 1 (S8-46/49/50) |
| E15 | **Oversight: 2 tests fail on the remote branch alone** (176 of 178 pass): "CC040 KPI figure", "AC2: every compliance figure is identical with and without queue waits" (`calculations.record_count` is 3, the test expects 0), "singular alias GET /api/analytics/kpi...", "TT3 through the route". | Same, on a fresh database. | BE Dev 1 |
| E16 | Because of E14 and E15 the root `npm test` stops there (exit 1), so safety and integration did not run on the merged tree. | Trial merge of both branches in a temporary copy. | BE Dev 1 |

Our side on the merged tree: front end 1,306 of 1,306, shared 95, gateway 59, core 595 and 133, identity 212 all pass. The failures are in code we did not change and do not touch.

**Push question:** pushing our branch under its own name is safe. Pushing straight to `codebase-for-deployment` is refused until it is merged, and merging it would put a branch whose CI is red (E14, E15) on the deployment line, so ask BE Dev 1 first.
