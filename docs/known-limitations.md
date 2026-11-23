# Known limitations (front end), as of 2026-11-24, commit `01e63ae`

For the defense. Each line says what a user may meet and why. Items that need someone else are in `needs-clarification.md`.

## Not shown or not possible yet
- **Staff names for Office Heads.** "By staff member" says "Staff member": only a Super Admin may read accounts, and the KPI answer carries no names (backend).
- **Overdue minutes on late-risk items.** The backend sends no limit, elapsed or overdue minutes, so the screen shows what it can (backend).
- **Escalation.** There is no escalation endpoint, so there is no Escalate button (backend).
- **Contact route, Privacy and Accessibility pages** in the public footer: not approved, so not shown (D8-12).
- **Public tracking of a transaction.** There is only a complaint status page.
- **Session policy.** The front end for it was removed on purpose; Identity has it behind `SESSION_POLICY_ENABLED`, and the Clerk sign-in is not covered.

## Data
- One transaction belongs to an office that is not in the catalogue; the office performance view shows "Unknown office" for it.
- The real data has no inactive office or service, so how screens treat them was checked with data edited in the browser only.

## What was checked, and how far
- Checked by script and by eye in a browser: accessibility audit at 360, 768, 1280 and 640 px (a checklist, not a WCAG certification), the role walkthrough (no participants), the retests of DEF-14 to DEF-20.
- **Not checked by a person:** a screen reader on the account menu (axe still flags it), the print slip, the queue countdown message, Office Head and Staff with real accounts.
- **Not run:** a hosted run of the four chains (no approved demo accounts), real saves for the defect retests (they write records), the QA stack (S8-18).
- The browser e2e script `tests/e2e/analytics-dashboards.cjs` does not pass: its Service Charter Compliance steps describe the layout before the office performance redesign, and its "no duplicate request" counts fail on the development server because React runs effects twice there.

## Known good to say plainly
- 1,306 front-end unit tests pass; lint has 0 errors and 2 old warnings.
