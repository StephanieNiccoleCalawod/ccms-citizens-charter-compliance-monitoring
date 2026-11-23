# Walkthrough log: role-based usability (S8-41)

**Date:** 2026-11-24. **Who walked:** the FE developer, using a scripted browser run. **No participants took part.** This is an expert walkthrough, not a usability study: there is no SUS score and no claim about how real staff, heads or citizens find the system. The real walkthrough with people is still to be done (see "Deferred").

How it was run: one script opened each task from the menu, counted clicks, and recorded where the task ended, the page heading, console errors, and any "undefined / NaN / null" text on the page. Nothing was saved or sent. Super Admin and citizen pages used the real system (read only). Office Head and Office Staff used a mocked sign-in with empty data, because no real account of those roles was available, so their screens were checked for reaching the task, not for how real records read.

## Task success

| Role | Task | Result | Clicks |
|---|---|---|---|
| Citizen (360 px) | Find a service and read its requirements | Done | 2 |
| Citizen | Check a complaint with a wrong number | Done, clear "could not find" message | 1 |
| Citizen | File a complaint, submit empty | Done, error announced, nothing sent | 1 |
| Citizen | Take a queue number (open page) | Done | 0 |
| Super Admin | Open Add Account and cancel | Done | 2 |
| Super Admin | Reach Transaction settings | Done | 2 |
| Super Admin | See who changed something (Logs) | Done | 1 |
| Super Admin | Find an overdue transaction (Late-risk) | Done | 1 |
| Super Admin | Open a transaction record | Done | 2 |
| Office Head | Start a transaction (open form) | Done | 2 |
| Office Head | Open the Queue | Done | 1 |
| Office Head | Late-risk list | Done | 1 |
| Office Head | Working hours (view only) | Done | 2 |
| Office Staff | Same four tasks as Office Head | Done | 2 / 1 / 1 / 2 |

No task needed more than two clicks. No page had overflow, "undefined"/"NaN" text or a console error in the final run.

## Issues found

| # | Issue | Role | Severity | Decision |
|---|---|---|---|---|
| 1 | Queue page crashed ("This page couldn't load") when the server reply was not a queue board | Staff, Head | High | **Fixed:** shows the retry message and tries again |
| 2 | The service directory had no top-level heading (only an h2), so screen readers could not jump to the page title | Citizen | Medium | **Fixed:** now an h1, same look |
| 3 | Add Transaction is a button that opens a form, while other "create" actions are links; staff may look for a page | Staff | Low | **Deferred:** needs a staff to say if it matters |
| 4 | Menu order for each role is a proposal (D8-20) | All | Low | **Deferred:** PM decision |
| 5 | Account menu name still flagged by axe at 640 px and wider | All | Low | **Deferred:** needs a screen reader (see `not-done-yet.md`) |

Accessibility issues found earlier in the same week are in `accessibility-checklist-S8-38.md` (all fixed except item 5 above). Wording and menu notes are in `ux-glossary-D8-16-draft.md` and `ux-walkthrough-S8-36.md`.

## Deferred, with the reason

- **Real walkthrough with an Office Staff, an Office Head, a Super Admin and a citizen:** needs participants and a PM or QA to run it. Suggested tasks are in `ux-walkthrough-S8-36.md`.
- **Office Staff and Office Head with real data:** needs real accounts of those roles.
- **Start, Hold/Resume and Complete end to end:** not run, because it writes records. Do it on a test office.
- **Confusion that only people can show** (wording, long forms, the order of steps): cannot be found by script.
