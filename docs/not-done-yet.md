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
