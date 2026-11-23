# Not done yet (FE, Sprint 8)

Things we did not finish, could not check, or left on purpose. The PM questions are in `questions-for-pm.md`.

## Accessibility (S8-38) — `accessibility-checklist-S8-38.md`
- Account menu in the header: axe still reports "label in name" at 640 px and wider. Needs a screen-reader check.
- Not audited: the print slip layout, the countdown message on queue take, and Office Head / Staff pages with real accounts (only a Super Admin session was available).
- No human screen-reader pass (NVDA/VoiceOver) on the four journeys.
- Past-entry checkbox on Start is 16 px (label row is clickable); left as is.
- The audit script's "keyboard trap" flag is a false positive; the script is not in the repo.

## Verification still needed
- Live 403 checks for S8-15 need test accounts for each role.
- Human walkthrough of S8-36 (`ux-walkthrough-S8-36.md`) and the wording list (`ux-glossary-D8-16-draft.md`).
- Orphan office id `2b696c02-5adc-43d5-8977-a2818ed94552` (1 transaction) is not in the catalogue, so the new view shows "Unknown office"; the old heatmap shows "Office". Data issue, not FE.

## Waiting on BE / PM (not editable by us)
- Late-risk items have no limit / elapsed / overdue minutes field.
- No escalation endpoint.
- Session policy exists in Identity (`SESSION_POLICY_ENABLED`) but Clerk is not covered; the FE work for it was removed and backed up in `session-policy-fe-backup/`.
- Transaction-settings audit is unproven; forecast row with 0 transactions; `calculations` (S8-46) not used yet; lunch fixtures; backdated Start entries are not covered by the unique indexes.

## Housekeeping
- Pull the 2 newer BE commits and push only when asked.
- The shared login password was pasted in chat; it should be changed.
- Send `questions-for-pm.md` to the PM.
- Two ESLint warnings are older than this work.
- Commits for S8-25, S8-35, S8-36, S8-37 and S8-38 are in one commit because the same files were touched by several tickets.

## Public footer (S8-16)
- Footer is built (`PublicFooter.js`) on `/` and `/directory`. Waiting on D8-12: the approved contact route, the approved rights holder (the line uses the campus name for now), and Privacy / Accessibility pages (none exist, so no links).
- There is no public page to track a transaction; the footer links "Check a complaint" instead.

## Usability walkthrough (S8-41) — `walkthrough-log-S8-41.md`
- Only a scripted walkthrough was done (no participants, no SUS). The real walkthrough per role still needs people and a PM/QA to run it.
- Not run: Start, Hold/Resume, Complete end to end (they write records; use a test office). Office Head and Staff were checked with a mocked sign-in and empty data.
- Deferred: Add Transaction being a button, not a link (low); menu order (D8-20).

## Retest V1 / S8-10 — `retest-V1-DEF14-18.md`
- DEF-14 (complaint email to a test mailbox, M6-10) not run: needs SMTP and a test mailbox. Operations `receipt.test.js` hung here and its result is unknown.
- DEF-16/17/18 passed on the local stack only; repeat on the QA stack (S8-18) and with real Office Head / Executive accounts.

## Retest V2 / S8-11 — `retest-V2-DEF19-20.md`
- Real saves not done (would write to the system): two blank employee numbers, a real duplicate, and turning "applies to" off after removing its entries. QA to run on the QA stack after the migration is applied there (S8-19). The older Identity DB on port 5433 still has employee_no NOT NULL.

## Re-triage of older defects (S8-12) — `retriage-older-defects-S8-12.md`
- #6, #7, #9 were not retested: the ticket does not name them and the DEFECTS sheet is not in the repo. QA to send the rows.
- #3 was checked with an inactive office marked in the browser only (no inactive data exists). #12 and #2 were not saved for real.
- Decisions needed: #2 (password in Clerk mode), #8 (visible Edit button?), #10 (wording).

- Everything that needs an answer is collected in `needs-clarification.md` (PM, QA, BE, accessibility).

## Screen observations (S8-17) — `recheck-V4-S8-17.md`
- #2 (document ticks) and #6 (cancelled receipt) were checked at 1280 px only. #3 (staff names) is a backend gap.

## Four chains on the hosted release (S8-22)
- Not started: no hosted address, no approved demo accounts, no PM approval (D8-11), and the chains write records. Status for now: **Blocked, no safe environment**. See `needs-clarification.md`.

## Release run (S8-27) and freeze (S8-28) — `release-run-record-S8-27.md`, `evidence-manifest.md`
- Not run: `next build` and `npm audit` (see the record), the CI run, hosted smoke. The f0b936e failing test is still unnamed.
- Not done: freeze record, backup demo video, rollback note, final RTM and test plan. The user manual and limitations list are drafts.
- The browser e2e script is stale after the redesign and needs a rewrite of its Charter-tab steps.

- Everything open is also compiled in one file: `open-items-all.md` (errors, PM questions, QA and BE asks).
