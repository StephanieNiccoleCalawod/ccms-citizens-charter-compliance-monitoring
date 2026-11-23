# S8-38 Accessibility checklist

This is a **checklist, not a WCAG certification.** It was run with an automated browser audit (Chromium + axe-core, WCAG 2.0/2.1/2.2 A and AA rules) plus keyboard tabbing and size/overflow measurements. A person with a screen reader should still walk the four journeys once.

Widths tested: **360, 768, 1280** and **640** (the same as 200% zoom on a 1280 window). Pages were read only; nothing was saved.

## Result per journey and width

| Journey | Pages | 360 | 640 (200%) | 768 | 1280 |
|---|---|---|---|---|---|
| Citizen: track / file a complaint | `/complaint`, `/complaint/status`, `/queue/take`, `/rate`, `/directory`, `/login` | Pass | Pass | Pass | Pass |
| Staff: start a transaction, list, details | `/transactions/new`, `/transactions` | Pass* | Pass* | Pass* | Pass* |
| Office Head: dashboard, late risk | `/`, `/late-risk` | Pass | Pass** | Pass** | Pass** |
| Super Admin: accounts, settings, calendar | `/accounts`, `/settings`, `/settings/transactions`, `/calendar` | Pass | Pass** | Pass** | Pass** |

\* Past-entry checkbox on Start is 16 px; its whole label row is clickable, so it is left as is.
\** One axe item remains at 640 px and wider (see "Still open").

Checked on every page and width: no horizontal page scroll, no control clipped outside a scrolling area (AC2), every control has a name, no focus stop without a visible ring, no keyboard trap, links and buttons at least 24 px tall.

## What was fixed (FE only)

| Finding | Fix |
|---|---|
| Muted text 4.36:1 on the page grey (needs 4.5:1) | Page background is now the approved `#F8FAFC` (4.55:1) |
| Grey pills, chart toggle, field labels, risk text under 4.5:1 | Approved Secondary Text `#475569` (6.95:1 or more) |
| 16-20 px high links and buttons (Back, Compare by office, View Details, Show, header links, View requirements) | `min-h-6` (24 px, WCAG 2.2 2.5.8); shared `btn-link` too |
| Tab panels took focus with no ring | One rule shows a maroon focus outline |
| Account menu name did not hold the visible text | The name now starts with the name and role the button shows |
| Complaint reference error was only linked to the field | `role="alert"`, so it is announced |
| Long reference number could push the page wide | Wraps (`break-all`), tested with a 77 character reference at 360 px |

Regression test: `tests/unit/s8-38-accessibility.test.js`.

## Keyboard order (AC1)

Tab order follows the screen: skip to menu links, then page content, then rows. Tested by tabbing 60-90 stops on `/directory` and `/transactions` with no trap. Status and errors: forms use `role="alert"`/`role="status"` (complaint, start transaction, accounts, queue, complaint status).

## Still open

1. **Account menu name** still flagged by axe (`label-content-name-mismatch`) at 640 px and wider, even when the name equals the visible text. Looks like the way the visible text is built (name and role on two lines); needs a screen-reader check before changing more.
2. **Not covered by this run:** the printed slip layout, the live countdown message on queue take, Office Head and Staff roles with real accounts (only the Super Admin session was available; those pages share the same shell and components), and a human screen-reader pass.
3. The audit's "trap" flag on `/directory` and `/transactions` is a false positive from rows with identical button text; the stop-by-stop tabbing showed different rows each time.
