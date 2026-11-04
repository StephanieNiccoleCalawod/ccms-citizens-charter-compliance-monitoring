# CCMS_UI_DESIGN_AUDIT — Phase 1: Read-only Design Audit

| | |
|---|---|
| **Project** | `D:\Capstone 2 V2\ccms-frontend-draft-frontend` |
| **Date** | 2026-10-12 |
| **Scope** | Visual design, styling consistency, layout, responsiveness, UX. No business logic, API or auth review. |
| **Status** | **Phase 1 only. Nothing in the application was changed.** This file is the only addition to the project; a hash manifest of all 85 other files was identical before and after the audit. |
| **Next step** | Awaiting your approval of the findings and a confirmed current backup before any Phase 2 work. |

## 1. Method and limits

- **What was captured.** 78 screenshots and automated measurements of 14 routes, in these states: signed-out, each of the 4 roles, loading, empty, error, success banner, add-account modal, row menu, confirm dialog, sign-out dialog and mobile menu. Viewports: desktop 1440 × 900, tablet 820 × 1180, mobile 390 × 844. Plus 1920 and 2560 px widths for content-width.
- **Data was mocked.** Every `/api` call was answered by a script, with realistic Filipino names, offices and services. No credentials, no backend, no real data.
- **Measured:** page overflow, text contrast (computed from real colors and backgrounds), target sizes, a keyboard-focus pixel comparison (screenshot with and without focus), and a style inventory (button colors, radii, input heights).
- **Corrections to my own automated output.** A first contrast pass listed a visually hidden screen-reader label as "1:1" (false positive), and a first focus check looked at CSS and wrongly flagged buttons. Both were discarded and redone. The numbers below come from the corrected runs.
- **Not verified:** real long strings and real data volumes; screen readers; browsers other than Chromium; real touch devices; 200% zoom and text-spacing overrides; forced-colors mode; print; the production build (everything ran on the dev server).
- **Screenshot artifact, not a bug:** full-page captures show the sidebar ending at viewport height with white beneath it. The sidebar is `sticky` and stays on screen while scrolling.
- **Screenshots and scripts** are outside the project, in the session scratchpad:
  `C:\Users\villa\AppData\Local\Temp\claude\D--Capstone-2-V2\ab4726e1-c03a-4a00-a2d2-d72386b818b3\scratchpad\design\` (images, `design-metrics.json`) and `...\scratchpad\` (`design-capture.cjs`, `design-measure2.cjs`, logs).

## 2. Overall assessment

The system already has a strong identity: a consistent maroon and gold palette, a polished sidebar, a clean card and table language, and a good public landing page. **No screen overflowed the page horizontally at any of the three viewports (57 screens measured).** Focus rings are present on every control except one.

The remaining problems are **consistency and states**, not a lack of design: three different primary-button treatments, contradictory loading, empty and error messages, tables that don't adapt to phones, and a Calendar page that doesn't follow the rest of the system.

**Strengths worth keeping:**
- Card, table, badge and filter-bar patterns are visually coherent.
- Filters stack cleanly on small screens.
- Modals and the row menu are clear, with good focus treatment.
- The public hero, service cards and pager look professional on all three widths.
- Dialog and banner colors (green, red) are meaningful and consistent.

## 3. Prioritized visual issues

Priority: **P1** = clearly harms usability or looks broken; **P2** = visible inconsistency or weak polish; **P3** = refinement. "Evidence" cites a screenshot (`name-viewport.png`) or measurement.

| ID | Pri | Issue | Evidence | Files and lines | Proposed fix |
|---|---|---|---|---|---|
| D-01 | P1 | **Data tables don't work on phones.** In Accounts the table scrolls sideways inside its card with no cue. The Status and Actions columns are off-screen, names wrap mid-word (`Ana / Cruz`) and employee numbers break (`EMP- / 1000`). The same pattern applies to every table. | `accounts-mobile.png`; no page overflow (the card scrolls) | `accounts/page.js:249`, `services/page.js:191`, `offices/page.js`, `calendar/Terms.js`, `services/[id]/page.js` (standards), `SyncPanel.js`, `globals.css:75–80` (`.th`, `.td`) | Below `md`, show rows as stacked cards (name, key fields, actions together); keep the table from `md` up. As a lighter fallback, add column minimum widths, a sticky first column and an edge fade. |
| D-02 | P1 | **Loading, empty and error states contradict each other.** While loading, the table says "Loading accounts…" and the footer says "No accounts". On an API error, the red banner appears with "No accounts match." and "No accounts" beneath it, which implies the list is empty rather than failed. Columns also collapse to equal widths until data arrives, so the layout jumps. Empty states are one plain text line with no guidance. | `state-loading-accounts-desktop.png`, `state-empty-accounts-desktop.png`, `state-error-accounts-desktop.png` | `accounts/page.js:262,264,304`; `services/page.js:206,212`; `offices/page.js:118,124`; `Pager.js:6` | One shared presentational `TableState`: skeleton rows while loading, an empty state with icon, one line of guidance and the page's existing add button, an error state with a Retry that calls the existing loader. Hide the footer unless data is loaded. |
| D-03 | P1 | **The Calendar page breaks the visual system.** The Working-hours tab switches to green (selected day pills, a full-width green "Save & publish" button), 50 px / 16 px / 8 px-radius inputs against the standard 38 px / 14 px / 6 px, and bolder labels. The Sync status panel, an operational table, sits above the tabs and pushes the primary content down. Heading sizes jump between 14, 18, 20 and 30 px. On tablet and mobile the month grid, the main content, lands last. | `calendar-hours-desktop.png`, `calendar-holidays-desktop.png`, `calendar-holidays-tablet.png` | `WorkingHours.js:24–26,153,200,204,224`; `Holidays.js:185`; `calendar/page.js:25`; `Holidays.js` (DOM order of the sections near lines 241, 296, 337) | Restyle Working hours with the shared `.input`, `.label` and `btn-primary`; use maroon for selected states; move Sync status below the tabs or collapse it; apply one heading scale; on small screens put the month grid before the registry. |
| D-04 | P1 | **No visible focus on the public search box.** A pixel comparison with and without keyboard focus changed nothing for this input, while every other control tested (about 150 across 8 pages) did change. | focus test: `input[search] "public-search"` | `page.js:160,200` (`focus:outline-none` on the input; the wrapping form has no `focus-within` style) | Add `focus-within:ring-2 ring-gold-500` to the search form wrapper. |
| D-05 | P1 | **Low-contrast text.** Placeholders are `#90a1b9` on white = **2.63:1** (needs 4.5:1). Greyed adjacent-month day numbers in the calendar are **2.51:1** (33 nodes). "Inactive" and "Optional" badges are **4.35:1** (just under, 39 nodes). The sidebar subtitle "CCMS" is **4.38:1**; that value was my own choice when matching the reference. | measured via computed colors; `calendar-holidays-desktop.png` | `globals.css:58` (placeholder:text-slate-400), `globals.css:69` (`.badge-inactive`), `Holidays.js:387` (`text-slate-400`), `AppShell.js` (subtitle `text-pup-gray/60`) | Placeholder to slate-500 (4.76:1); badge text to slate-600; day numbers to slate-500; subtitle opacity from 60% to 75%. |
| D-06 | P2 | **Primary buttons use different colors.** Standard is maroon `#6b0f0f`; "+ Add Holiday" is `#520909` through an override; "Save & publish" is green `#008236`; the hero Search is gold `#d4a017`. Table headers use `maroon-950` while the sidebar uses `#800000`. Two parallel palettes (`maroon-*` and `pup-*`) exist. | button-color inventory; `calendar-holidays-desktop.png` | `Holidays.js:233` (`bg-maroon-900` on a `btn-primary`); `globals.css:3–19`; `.th` | Remove the override, define the palette once (alias `pup-*` onto the scale), and pick one table-header color. |
| D-07 | P2 | **Weak heading hierarchy.** The page title appears twice (grey label in the top bar and the H1). Service Details uses the generic H1 "Service Details" while the service name is only an H2. H2 appears at 14, 18, 20, 24 and 30 px. DM Serif is applied to every heading, including small card titles. | `service-detail-desktop.png`; heading inventory: H2 at five sizes | `AppShell.js:150` (title span) and the H1 below it; `services/[id]/page.js:187`; `globals.css:31–35` | Drop or repurpose the top-bar title (for example breadcrumb); make the service name the page title; define two H2 sizes; keep serif for page titles and major sections only. |
| D-08 | P2 | **Row actions look different on each page.** Accounts uses a kebab menu. Services, Offices, Terms, Holidays and Documents use inline text links ("View Edit Deactivate"), which are only 20 px tall (under the 24 px WCAG 2.2 minimum for standalone targets). | `services-tablet.png`; target-size scan: View 31×20, Edit 24×20, Deactivate 67×20, Delete 41×20 | `services/page.js:236–249`, `offices/page.js:137–145`, `Terms.js`, `Holidays.js`, `services/[id]/page.js` | Pick one pattern (kebab for 3+ actions, inline otherwise), and give `.btn-link` padding or min height so targets reach 24 px or more. |
| D-09 | P2 | **Feedback banners are re-implemented per page.** The green success banner exists in four places and has no shared component. It is inserted above the content, so the whole page jumps down about 62 px when it appears, and it stays until dismissed. | `success-banner-desktop.png` | `accounts/page.js:201`, `services/[id]/page.js:176`, `WorkingHours.js:128`, `login/page.js:127`; `ErrorBanner.js` | One `StatusBanner` with success, info, warning and error variants. Reserving space or moving to a corner toast is a design choice (an auto-dismiss timer would be new behavior and needs separate approval). |
| D-10 | P2 | **Touch targets are small on phones.** Buttons 34 px, kebab 32 × 32, nav links 38 px, selects and inputs 38–39 px, all under the common 44 px guideline (WCAG 2.2 minimum is 24 px, which most meet). | target-size scan; `accounts-mobile.png` | `globals.css` (`.btn`, `.input`), `RowActionMenu.js` | Add a larger mobile minimum height (`min-h-11` below `sm`). |
| D-11 | P2 | **Content width is uncapped.** At 1920 px the content area is 1664 px and tables 1598 px wide; at 2560 px, 2304 px. Forms and tables stretch far beyond comfortable reading width. | `design/accounts-1920.png`; widths measured | `AppShell.js:173` (`<main className="px-4 py-6 sm:px-8">`) | Wrap content in `mx-auto max-w-7xl` (or similar). |
| D-12 | P2 | **Tablets get the phone layout.** From 768 to 1023 px the sidebar is hidden behind a Menu button and opens above the header, pushing content down, even though 820 px has room for the sidebar. | `calendar-holidays-tablet.png`, `mobile-menu-open-mobile.png` | `AppShell.js:105,147` (`lg:` breakpoints) | Use `md` for the persistent sidebar (or a collapsed icon rail), and make the mobile menu an overlay drawer. A drawer adds open/close and focus behavior, so it needs your approval as an interaction change. |
| D-13 | P2 | **Error and 404 pages are unbranded.** The 404 is a bare white page with small text and no way back. A runtime error shows Next's default "This page couldn't load". | `not-found-desktop.png`; the calendar page crash seen during mocking | no `not-found.js` or `error.js` in `src/app/` | Add branded `not-found.js` and `error.js` that reuse `PublicHeader`, the brand colors and one clear action. |
| D-14 | P2 | **Role home pages look unfinished.** Office Home and Campus Home show a single sentence in a card with the rest of the page empty. | `office-home-desktop.png` | `office/page.js`, `campus/page.js` | Use a structured empty state ("what will appear here") rather than a lone sentence. |
| D-15 | P3 | **Very small text.** 10–11 px in calendar chips and section captions. | min font: 10 px desktop and tablet, 11 px mobile | `Holidays.js:300,374,406` | Raise to at least 12 px where space allows. |
| D-16 | P3 | **Search looks and behaves differently on each page.** Accounts is a debounced box with no button, Services has a Search button, the public page has a gold button, signed-in Home searches on Enter only, Holidays searches as you type. Input height and radius also vary (38, 39, 50 and 56 px; 6, 8 and 0 px). Labels vary too (12 px at weight 600 or 700, two greys). | style inventory | `accounts/page.js`, `services/page.js`, `page.js`, `Holidays.js`, `WorkingHours.js` | Settle one search-box component and one field style (`.input`, `.label`). |
| D-17 | P3 | **Two brand treatments on first-contact screens.** The login left panel is a flat maroon with large empty space, while the public hero uses a gradient with brownish blotches. | `login-desktop.png`, `public-home-desktop.png` | `login/page.js`, `globals.css:83–88` (`hero-bg`) | Align the login panel with the hero treatment, and soften the gold glows. |
| D-18 | P3 | **Unused whitespace in the Calendar.** The "Click a date…" card and the Version history card leave large empty areas; the back link sits tight against the Service Details card. | `calendar-holidays-desktop.png`, `calendar-hours-desktop.png`, `service-detail-desktop.png` | `Holidays.js` (`min-h-48` card), `WorkingHours.js` (history section), `services/[id]/page.js` | Reduce stretching, add consistent vertical spacing. |
| D-19 | P3 | **Mobile public search placeholder is clipped** ("Search by service or office r…"). | `public-home-mobile.png` | `page.js:197–201` | Shorten the placeholder text on small screens. |

## 4. Measured evidence (summary)

| Check | Result |
|---|---|
| Page-level horizontal overflow | None, across 57 screens at 3 viewports |
| Tables that clip content inside their card on mobile | Accounts, and the same markup elsewhere (D-01) |
| Keyboard focus visible (pixel test, ~150 controls on 8 pages) | All except the public search input (D-04) |
| Low contrast found | Placeholders 2.63:1; adjacent-month days 2.51:1; Inactive/Optional badges 4.35:1; sidebar subtitle 4.38:1 |
| Button background colors in use | white, `#6b0f0f`, `#520909`, `#008236`, gold `#d4a017` |
| Input height / font / radius variants | 38–39 px / 14 px / 6 px (standard); 50 px / 16 px / 8 px (Working hours); 56 px / 16 px / 0 (hero search) |
| Heading sizes | H1 24–48 px; H2 at 14, 18, 20, 24 and 30 px; H3 at 16, 18 and 24 px |
| Standalone targets under 24 px tall | row-action links, "View requirements", "Back to services", "Set different hours", Dismiss-style links |
| Content width at 1920 / 2560 px | 1664 / 2304 px; no maximum |

## 5. Proposed remediation plan (Phase 2, not started)

The smallest set of changes, grouped so each can be approved and verified on its own.

**A. Tokens and shared utilities** (`globals.css`): one palette; placeholder and badge contrast; a heading scale; a minimum target size for `.btn-link`; mobile minimum heights.

**B. Shared components** (new small files, presentational only): `StatusBanner`, `TableState`, a responsive-row pattern for tables, a content-width wrapper in `AppShell`.

**C. Page changes:**
- Calendar tabs (restyle `WorkingHours.js`, reorder and re-scale headings, Sync status placement).
- Mobile layout for Accounts, Services, Offices and the other tables.
- Row-action consistency; the public search focus ring.
- Branded `not-found.js` and `error.js`.
- Role home empty states.
- Login and hero brand alignment.
- Minor sizes, placeholders and spacing.

**Affected files** (all in `ccms-frontend-draft-frontend\src`): `app/globals.css`, `components/layout/AppShell.js`, `components/layout/PublicHeader.js`, `components/feedback/ErrorBanner.js`, `components/navigation/Pager.js`, `components/ui/RowActionMenu.js`, `app/page.js`, `app/login/page.js`, `app/accounts/page.js`, `app/offices/page.js`, `app/services/page.js`, `app/services/[id]/page.js`, `app/public/[id]/page.js`, `app/calendar/{page,Holidays,WorkingHours,Terms,SyncPanel}.js`, `app/{office,campus}/page.js`, plus new `components/feedback/StatusBanner.js`, `components/ui/TableState.js`, `app/not-found.js`, `app/error.js`.

**Items that would go beyond styling and need separate permission:**
- showing a loading state on *subsequent* loads, which means setting the loading flag when a request starts;
- auto-dismissing toasts (timers);
- the mobile menu as an overlay drawer (open/close, focus handling);
- any change to when the error and empty states appear beyond reordering existing conditions.

I would leave all of these out of Phase 2 unless you approve them.

## 6. Regression risks and validation plan

**Risks:**
- Tailwind class changes in dense tables can shift column widths.
- Duplicated markup for mobile cards can drift from the table version.
- Changing global tokens affects every page at once.
- Contrast changes alter the exact look you may have matched to a reference.

**Validation after approved changes:**
1. Unit tests and lint (`npm test`, `npm run lint`) must stay green. They don't exercise styling, so they can only catch breakage.
2. Re-run the existing mocked browser checks (the 64-check script) to confirm forms, dialogs and focus behavior are unchanged.
3. Re-run this audit's capture and measurement scripts and compare before and after: the screenshots at three widths, overflow, contrast, focus pixel test and target sizes.
4. Spot-check every route renders for each role.
5. Hash manifest before and after, so only the approved files change.
6. Anything not run (real devices, screen readers, a production build) stays marked **UNVERIFIED**. A build needs your explicit approval first, as it rewrites generated files.

## 7. Screenshot index (scratchpad `design\`)

`public-home-{desktop,tablet,mobile}`, `public-detail-*`, `login-*`, `reset-valid-*`, `reset-invalid-*`, `not-found-*`, `home-*`, `accounts-*`, `offices-*`, `services-*`, `service-detail-*`, `calendar-{hours,holidays,terms}-*`, `office-home-*`, `campus-home-*`, `state-{loading,empty,error}-*`, `modal-add-account-*`, `modal-add-service-desktop`, `row-menu-desktop`, `confirm-dialog-desktop`, `success-banner-desktop`, `signout-dialog-desktop`, `input-focus-desktop`, `mobile-menu-open-mobile`, `accounts-1920`.

*End of Phase 1. No implementation will begin until you approve these findings and confirm that a current backup exists.*
