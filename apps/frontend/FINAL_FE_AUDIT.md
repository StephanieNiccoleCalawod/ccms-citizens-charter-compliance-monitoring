# CCMS Frontend — Agent 4 Final Audit and Consolidation

**Review date:** 2026-10-12  
**Authorized scope:** `D:\Capstone 2 V2\ccms-frontend-draft-frontend`  
**Review type:** Read-only source and report review. This document is the only file created for this task. No application code, tests, vendor files, environment files, dependencies, lockfiles, backend services, databases, or CI/deployment files were changed. No services or validation commands were run. No Git operation was performed.

## 1. Executive summary

The frontend project root is confirmed by its `package.json`, Next.js configuration, and App Router source. It is a Next.js 16 / React 19 client-heavy app, with public service browsing and authenticated staff workflows. Authenticated API calls use same-origin API paths and a gateway rewrite. The browser’s role checks are presentation safeguards; this review cannot establish server authorization.

The architecture and security reports were available. The QA report and Phase 1.5A final implementation report were not found. Agent 1 reports 57 unit tests passing at a prior run, and the task brief also describes that result; neither is a current, independently verified run. Lint and build results were not available. Runtime behavior for account request debouncing/order and row-menu focus remains **UNVERIFIED/BLOCKED** because no browser test was run in this audit.

Current source independently confirms the two reported Phase 1.5A fixes: `accounts/page.js` now depends on individual filter values, retains the 300 ms query debounce, and guards list writes with a latest-request counter; `RowActionMenu.js` returns focus to its trigger before invoking an action. The account manager still does not set its loading flag when a subsequent request starts, and it does not invalidate a request on unmount. These are follow-up reliability details, not evidence that the requested fixes failed.

No P0 was verified. No P1 frontend defect was verified. The most important remaining verified findings are P2: Calendar’s ARIA tabs lack keyboard navigation and point inactive tabs at unmounted panels; unsaved modal forms can be discarded without an explicit dirty-form confirmation, while the global sign-out dirty warning is covered by the form modal and trapped outside its focus; and reset-password tokens remain in the URL after load. Security-header absence is verified in repository configuration but whether infrastructure adds headers at runtime is unknown. Several Agent 3 items are hardening recommendations, not demonstrated vulnerabilities.

## 2. Reports reviewed and limitations

| Report | Status | Use in this consolidation |
|---|---|---|
| `AGENT_1_FE_ARCHITECTURE.md` | Found and read in the frontend root | Architecture baseline and findings FE-01 through FE-22. Older claims were checked against current files; some are already addressed or changed. |
| `AGENT_2_FE_QA.md` | Not found in the frontend root or workspace file inventory | QA observations and claimed 57/57 result are not independently reviewable as a report. The 57/57 claim appears in Agent 1’s text and in the user task’s stated expected result; treated as reported only. |
| Agent 2 Phase 1.5A final implementation report | Not found | Current implementation was reviewed directly. No Agent 2 test logs, screenshots, or measured timings were available. |
| `AGENT_3_FE_SECURITY.md` | Found and read in the frontend root | Security findings SEC-01 through SEC-08 were checked against current frontend source and narrowed where claims depended on runtime/backend behavior. |
| Existing `FINAL_FE_AUDIT.md` at workspace parent | Exists outside the authorized frontend root | Not overwritten or used as a substitute. The requested target `ccms-frontend-draft-frontend/FINAL_FE_AUDIT.md` was absent before this report was created. |

The reports describe a non-Git working tree and earlier session changes. This review did not inspect or rely on Git history. Agent 1’s line references are from its review date and may have shifted; current-source references below are relative paths and current line locations where useful.

## 3. Consolidated findings and conflicts

### Duplicate and conflicting items resolved

- **Account debounce/request race:** Agent 1 FE-03 and related API-resilience observations overlap. The former account-specific defect is addressed in current source by value-based dependencies and a request sequence. Similar race handling is not present in every other list page, so the remaining concern is limited to those pages. The claim that the account search currently requests once per keystroke is outdated.
- **Row-action-to-modal focus:** Agent 1 FE-07 and Agent 3’s general accessibility context overlap. Current `RowActionMenu` focuses the kebab trigger with `preventScroll: true` before `item.onSelect()`. The modal’s focus-restoration logic can therefore capture the stable trigger. The account page fallback only moves focus to Add Account when the pending trigger has disappeared and focus is at `document.body`. The original focus-loss finding is addressed in source; browser behavior remains unverified in this audit.
- **Role handling / backend authorization:** Agent 1 and Agent 3 agree the UI validates role shape but is not authoritative. Current `session.js` calls `userFromClaims`, which checks `ROLE_LIST`; this does not validate JWT signatures. Token verification and endpoint role/office enforcement must be assessed at the gateway and backend, outside this frontend-only scope.
- **Session storage, CSP/security headers, reset-token URL, marker cookie:** Agent 1 FE-05/FE-14 and Agent 3 SEC-01/02/03/05 overlap. They are separated below into a confirmed storage design tradeoff, a repository-config observation with runtime uncertainty, a confirmed reset-token URL persistence issue with downstream exposure uncertainty, and a low-impact marker-cookie hardening item.
- **Timeouts and API consistency:** Agent 1 FE-04/FE-16 and Agent 3 SEC-07 overlap. There is no timeout/abort in the two common fetch paths inspected. This is a reliability concern, not a demonstrated security exploit.
- **Query parameter “sanitization”:** Agent 3 SEC-08 notes missing front-end length bounds but also confirms `URLSearchParams` encoding. No query-string injection flaw was verified. Bounds and validation are primarily backend responsibilities; a frontend maximum length is a UX/traffic control only.
- **Shared-package dependency footprint:** Agent 1 FE-06 and Agent 3 SEC-06 overlap. The frontend installs the vendored package whose manifest includes server libraries, but source tests assert frontend source does not import those server modules. Dependency-tree presence alone is not an exploitable frontend vulnerability.

### Findings table

| ID | Priority / severity | Finding and evidence | Status / impact | Minimal recommendation; dependency and verification |
|---|---|---|---|---|
| A4-01 | P2 / Medium | Calendar tabs declare `tablist`/`tab`, `aria-selected`, and `aria-controls`, but `src/app/calendar/page.js` changes tabs only on click. All tab controls refer to `panel-{id}`, while only the selected panel is mounted. No Arrow/Home/End or roving `tabIndex` behavior exists. | **Confirmed.** Keyboard and assistive-technology users may not get a valid tabs interaction. | Implement standard keyboard tab behavior and ensure each control relationship points to a live panel, or replace tab roles with ordinary buttons/sections. Frontend-only. Add component/browser checks; runtime remains unverified. |
| A4-02 | P2 / Medium | `src/app/reset-password/page.js` reads `token` from `useSearchParams()` and retains it through submit and completion; no URL cleanup is present. `src/lib/api/client.js`/rewrite routes the request same-origin. | **Confirmed URL persistence.** Exposure through browser history, screenshots, referrer headers, or infrastructure logs is a **risk requiring runtime/deployment evidence**; no log exposure was verified. | Remove the token query from the address bar after safely capturing it, while retaining it in component state for submission; consider an appropriate referrer policy at the serving boundary. Frontend URL cleanup is local; header/log verification needs runtime and gateway review. |
| A4-03 | P2 / Medium | Dirty forms register with the global registry through `Modal`’s `dirty` prop, but ordinary form-modal `onClose` and Cancel handlers set form state to `null` without checking dirty state (examples: `src/app/accounts/page.js`, `src/app/offices/page.js`, `src/app/services/page.js`, `src/app/calendar/Terms.js`, `src/app/calendar/Holidays.js`, `src/app/services/[id]/page.js`). The backdrop and Escape call the same `onClose`. | **Confirmed discard behavior.** Unsaved edits disappear on Escape, backdrop click, or Cancel. Cancel may be intended to discard; there is no discard warning. | Decide whether Cancel is an explicit discard action or should confirm when dirty. If confirmation is desired, use a discard dialog and make Escape/backdrop follow the same decision. Frontend-only. Test clean/dirty and busy states. |
| A4-04 | P2 / Medium | `src/components/modals/Modal.js` traps focus and overlays the viewport. `src/components/layout/AppShell.js` renders the Sign out control behind that modal. `tests/e2e/smoke.cjs` itself labels the Sign out control as covered by the form modal and exercises the second dialog through script evaluation. | **Confirmed UI limitation.** The global dirty-form sign-out warning cannot normally be initiated while a form modal is open, despite the registry detecting dirty forms. | If the product requires sign-out while a form is open, expose an in-modal sign-out action or redesign modal/shell layering. Keep this separate from modal discard confirmation. Frontend-only; browser verification needed. |
| A4-05 | P2 / Medium | `src/app/accounts/page.js` guards account list success/error state writes by a monotonic `latestRequest` ref. Other list pages (verified examples: `src/app/services/page.js`, `src/app/offices/page.js`, `src/app/calendar/Terms.js`) use effects without a latest-request guard or abort signal. | **Confirmed source pattern; user-visible out-of-order behavior is runtime-dependent.** Fast filter changes or repeated reloads can allow an older result to replace a newer one. | Add a latest-request/abort pattern to list loaders with changing filters, or a shared resource helper after scope is agreed. Frontend-only. Test delayed responses in reversed order. |
| A4-06 | P2 / Medium | `src/app/accounts/page.js` initializes `list.loading` as true but `load()` does not set it true at request start; filter setters do not do so either. Only the current request’s success/error handler sets it false. The request sequence prevents an older response from writing `loading:false` after a newer request has started (once the newer `load` has incremented the counter). | **Confirmed state behavior.** The loading row is not shown during subsequent account searches/reloads; old results remain visible until replacement. No stale older request can clear a newer request’s loading state because no request sets that state true. | Decide on stale-while-revalidate versus visible loading. If loading is intended, set loading when the newest request starts while preserving results, and let only that request finish it. Verify rapid filtering and action reloads. |
| A4-07 | P2 / Medium | `src/lib/auth/session.js` stores the access JWT in `sessionStorage` under `ccms_access`. Frontend JavaScript can read it. `src/lib/auth/guards.js` checks role shape only; it does not cryptographically verify token claims. | **Confirmed design; no XSS or token-forgery vulnerability demonstrated.** Same-origin script execution can read the stored token. Server-side gateway validation is a backend dependency. | Review threat model and token lifetime; consider a BFF/HttpOnly session design only with separate backend approval. Do not treat browser claim checks as authorization. Backend/gateway review required for enforcement and revocation expectations. |
| A4-08 | P2 / Medium | `next.config.js` defines a rewrite and disables `poweredByHeader`, but does not configure CSP or other security headers. | **Confirmed repository-config absence; runtime absence is unverified.** Hosting or proxy layers may set headers. | Inspect actual response headers in local/deployed contexts first. Add policy only if absent and with framework-compatible CSP design. Requires runtime/deployment evidence; config changes outside this audit. |
| A4-09 | P2 / Medium | Account search fix in `src/app/accounts/page.js`: `load` depends on `[page, appliedQuery, role, office_id, status]`, and the 300 ms effect remains keyed to `filters.q`. `latestRequest` gates both success and error writes. `setFilter` still resets page for non-query filters. Imperative calls remain after save, confirmed actions, and reactivate. | **Addressed in current source.** Request ordering and debounce remain **UNVERIFIED/BLOCKED** at runtime. There is no unmount cleanup to invalidate the active request. | Keep the value-based dependencies and sequence guard. Add request cleanup/abort if needed. Runtime-test debounce (one query after quiet period), rapid filter order, errors, action reloads, and unmount. No lint suppression found in the described code. |
| A4-10 | P2 / Medium | Current `src/components/ui/RowActionMenu.js` calls `close(true)` before `item.onSelect()`; `close(true)` focuses `buttonRef` with `{ preventScroll: true }`. `src/app/accounts/page.js` remembers the trigger and focuses Add Account only if the trigger was removed and active focus is `body`. Table row key is `account.account_id`. | **Addressed in current source; runtime behavior unverified.** Fallback avoids overriding focus that is already on another live control. | Retain this ordering. Browser-test Edit/Reset/Deactivate dialog open/close and row removal after filtering/reactivation. Check that scroll dismissal and outside-click behavior do not strand keyboard focus. |
| A4-11 | P2 / Medium | `src/app/**` forms largely keep drafts in component state. There is no `beforeunload` listener or application route blocker in the inspected source. Session checks in `AppShell` run periodically; `apiFetch` redirects to login after repeated 401 responses. `src/app/calendar/WorkingHours.js` has a standalone inline form; service detail also includes an inline standard form. These do not register via the modal dirty prop. | **Confirmed lack of persistence/guards; actual browser Back restoration is runtime-dependent.** Refresh/tab close and forced full-page auth redirect can discard unsubmitted state. SPA Back may be affected by router cache and is **unverified**. | See separate dirty-safeguard roadmap. Add a conditional `beforeunload` warning for registered dirty forms and register relevant inline forms. Internal SPA route blocking is separate; do not claim `beforeunload` covers it. Frontend-only. Browser tests needed. |
| A4-12 | P2 / Medium | `src/components/layout/AppShell.js` is mounted by individual signed-in pages rather than a shared authenticated route layout (Agent 1 FE-01; current pages continue to wrap themselves). The shell session check and mobile menu state can remount/reset on page navigation. | **Confirmed architecture; flash duration/impact not measured here.** | Plan separately as Phase 1.6 shared-layout work. Do not bundle with account, modal, or security fixes. Requires route/layout design and navigation regression coverage. |
| A4-13 | P2 / Medium | Agent 1 FE-02: public landing and public detail are client components that fetch in effects; root `src/app/layout.js` has one static metadata title. Current `src/app/page.js` switches to rendered content after client state/session check. | **Source pattern confirmed; SEO/perceived performance impact not measured.** | Consider server-rendered public shell/data and per-route metadata in a dedicated rendering phase. Verify public routes and dynamic metadata in production build/runtime before changing. |
| A4-14 | P2 / Medium | Agent 1 FE-08/FE-09 and current `src/components/layout/AppShell.js`/form source: mobile sidebar is conditionally shown before header in DOM and does not show Escape/outside-click handling; search found no `aria-invalid`/`aria-describedby` wiring for field errors. | **Source pattern confirmed; accessibility impact needs browser/assistive-technology validation.** | Make mobile navigation operable without losing access to its toggle, add skip navigation if applicable, and associate field errors programmatically. Frontend-only; test keyboard and screen reader. |
| A4-15 | P3 / Low | Agent 3 SEC-05: `setMarker()` in `src/lib/auth/session.js` sets `SameSite=Strict` but not `Secure`. This is a presence marker, not the access/refresh token. | **Confirmed attribute absence; transport exposure is deployment-dependent and impact is limited to a marker.** | Add Secure on HTTPS if consistent with supported local HTTP use; verify cookie attributes. Not a substitute for refresh-cookie checks by Identity. |
| A4-16 | P3 / Low | Agent 1 FE-04 / Agent 3 SEC-07: `apiFetch` in `src/lib/auth/session.js` and `publicFetch` in `src/lib/api/client.js` pass no timeout/abort signal. | **Confirmed source absence.** Slow/unavailable network can leave some UI loading states pending; no observed runtime hang. | Add optional signal and sensible timeout in a separately scoped API reliability change. Test timeout, cancellation, and user-facing errors. |
| A4-17 | P3 / Low | Agent 3 SEC-06: `package.json` depends on `file:./vendor/ccms-shared`; its `package.json` lists `jose`, `pg`, and `typeorm`, while frontend source imports role/navigation exports. The `structure.test.js` source check bans direct server-library imports. | **Confirmed footprint; no server package import into the frontend source was found.** | Optional: split a frontend-safe shared package or dependency surface. Requires shared-library owner approval; do not edit `vendor/ccms-shared` in a frontend-only fix. |
| A4-18 | P3 / Low | Agent 3 SEC-03: `src/app/reset-password/page.js` retains the query token after reading. | **Consolidated into A4-02**, which captures both address-bar and possible referrer/log exposure without overstating evidence. | See A4-02. |
| A4-19 | P3 / Low | Agent 3 SEC-08: `toQuery()` in `src/lib/api/client.js` uses `URLSearchParams`, which encodes values. Search controls have no uniform maximum length. | **No injection defect verified.** Large values may burden API/network; backend validation and query limits cannot be inferred. | Keep URL encoding. If useful, set UX input lengths and verify backend maximums separately. No backend security claim. |
| A4-20 | P3 / Low | Agent 1 FE-15/FE-16/FE-18/FE-19: no route error/loading/not-found boundaries were identified; reset page bypasses common API error helper; calendar paths are locally spelled; E2E smoke is not in CI; logo/font and styling consistency are optional optimization/polish topics. | **Mostly confirmed maintainability/performance observations; impact not measured.** `tests/e2e/smoke.cjs` full-system branch creates a service via POST and has no cleanup. | Prioritize test isolation before routine full-system runs. Defer component consolidation, asset/font tuning, and styling cleanup to optional work with measurements. |
| A4-21 | Info / Informational | `src/lib/auth/guards.js` validates recognized role strings, but that is not token signature verification or API authorization. `src/lib/auth/session.js` derives display data from decoded claims. | **Confirmed boundary.** A user can manipulate client state; protected data/actions must remain denied by the gateway/service. No backend route review was in scope. | Backend team should independently verify JWT signature/expiry/issuer/audience and role/office authorization on every protected route. Requires separate backend approval and audit. |

## 4. Phase 1.5A implementation review

### A. Accounts search and request ordering

**Source reviewed:** `src/app/accounts/page.js`.

- `filters.q` still uses a 300 ms timer before setting `appliedQuery` (`60–67`).
- `role`, `office_id`, and `status` are destructured (`71`) and added to the `load` dependency list individually (`91`). The whole `filters` object is not a dependency of `load`; no lint suppression was found in this code.
- Query construction uses the current page and applied search, then the three individual filters (`76–82`).
- `setFilter()` resets page to 1 for non-search filters (`106–109`); the query debounce also resets to page 1 (`62–65`).
- A `useRef` counter increments for each `load()` (`74–78`). Both success and catch paths ignore responses whose request number is no longer current (`83–90`), so stale requests cannot write results or errors after a newer request has started.
- Effect loading and imperative reload paths remain present: effect (`93–95`); after save (`143`); after confirmed deactivate/reset (`165`); after reactivate (`185`). Existing callback closure updates when dependencies change.
- **Loading caveat:** `load()` does not set `list.loading=true` when starting. The list’s loading state is initialized true and later set false, but not reactivated on subsequent requests. Therefore older responses cannot clear a newer request’s loading indicator; rather, later requests do not show the loading indicator at all. Decide whether stale rows during revalidation are intended.
- **Unmount caveat:** No cleanup increments the counter or aborts the current request. An outstanding promise can still reach a `setList` call after this manager unmounts. It cannot update a later manager instance’s local state, but can cause an unnecessary completion. Add cleanup/abort only if desired and covered.
- **Runtime status:** Debounce timing, reverse-order responses, failure ordering, unmount behavior, and imperative reload timing are **UNVERIFIED/BLOCKED** in this audit. Unit tests shown in available sources focus on session, roles, dirty registry, sign-out flow, and structure; no accounts request-order test was located.

### B. Row-action menu focus

**Source reviewed:** `src/components/ui/RowActionMenu.js`, `src/components/modals/Modal.js`, `src/app/accounts/page.js`.

- On item activation, the menu calls `close(true)` before `item.onSelect()` (`105–110`). `close(true)` returns focus to the kebab trigger with `focus({ preventScroll: true })` (`20–24`). This is the correct order for a dialog opened by the action to capture the trigger as its opener.
- The modal records its opener (`50–53`) and restores the provided `returnFocusRef` or opener on close (`117–124`). The accounts page does not supply a special ref to the row dialog; it relies on the captured trigger.
- The accounts fallback records the active trigger (`39–42`) and only moves focus to Add Account after the dialog/action is complete, if the trigger was removed and active focus is `body` (`43–51`). It does not steal focus if the trigger remains or focus is already on another element. It covers row-filter/removal cases when React drops focus to body.
- Rows use the stable `account.account_id` key (`267`).
- Escape on an open menu returns focus to the trigger (`43–47`). ArrowUp/ArrowDown cycle enabled menu buttons (`63–70`). Outside pointer closes the menu; focus normally follows the clicked target. Scroll/resize dismisses without explicit focus restoration, and the `role="menu"` implementation does not cover the full menu keyboard pattern (for example Home/End/Tab behavior). This is a lower-priority follow-up if browser/AT testing finds focus loss.
- **Runtime status:** Focus capture at the moment a React modal opens, filtered-row removal fallback, Escape behavior, and `preventScroll` interaction with the scroll-dismiss listener remain **UNVERIFIED/BLOCKED** in this audit. The Playwright smoke source has sign-out-dialog focus checks but does not establish this row-menu flow.

### C. Validation evidence

- **`npm test`:** 57/57 is reported in Agent 1’s report and referenced in the user brief. This is a reported prior result, not independently verified. No Agent 2 report or raw test output was found.
- **`npm run lint`:** No result/log found. Not run.
- **`npm run build`:** No result/log found. A `.next/BUILD_ID`/build output exists, but it may be stale and is not proof of a successful build of current source. Not run.
- **Runtime debounce and focus:** **UNVERIFIED/BLOCKED**. No runtime commands were run.
- **CI:** `.github/workflows/ci.yml` defines `npm ci`, lint, unit tests, and build. It provides no run result.
- **E2E safety:** `tests/e2e/smoke.cjs` has mocked logout checks and an optional real full-system branch. That branch posts a new service and does not clean it up. Use only against a disposable database unless separately made safe.

## 5. Dirty-registry and data-loss risk assessment

`src/lib/ui/dirty-registry.js` tracks live dirty predicates and cleans them up when the registered modal unmounts. `Modal.js` registers only when a `dirty` prop is provided. `useFormDirty.js` compares the current modal form with its opening baseline. `useSignOut.js` reads the registry and changes the sign-out message. This mechanism detects changes; it does not persist drafts and does not guard every way the page can be left.

| Exit path | Evidence and classification |
|---|---|
| Browser refresh | **Confirmed data-loss path for unsaved in-memory form values.** Forms are React state; no persistence or `beforeunload` guard was found. Reload discards component state. Browser warning behavior is not present. |
| Tab/window close | **Confirmed unguarded path** with unsaved values in memory. Browser/mobile lifecycle behavior varies; no guard or draft persistence is present. |
| Browser Back | **Suspected/UNVERIFIED.** App-level route interception was not found, and page-local form state may unmount. Next router cache/restoration may preserve some state; this needs real browser verification. |
| Escape | **Confirmed discard behavior.** Modal handles Escape by calling `onClose`; form callers set their form state to null. No dirty-specific discard prompt. |
| Modal backdrop click | **Confirmed discard behavior.** The backdrop calls the same `onClose` handler; dirty is registered but not consulted by close logic. |
| Cancel controls | **Confirmed intentional discard behavior in source.** Cancel sets form state to null. Whether to warn is a product decision; if data-loss prevention is desired, dirty Cancel should confirm discard. |
| In-app navigation | **Partially blocked while modal is open** because modal overlay/focus trap covers the page. No route blocker was found for navigation initiated by history or programmatically. State-loss behavior on specific transitions needs runtime testing. |
| Session expiry/forced redirect | **Confirmed potential discard path.** Shell periodically obtains/refreshes a token and redirects when it cannot obtain one; `apiFetch` redirects after repeated 401. No dirty draft persistence protects a form during such redirect. Exact timing and backend response semantics are runtime/backend-dependent. |
| Sign out while modal open | **Confirmed UI/accessibility limitation.** The sign-out button is behind the full-screen modal and outside its focus trap; the supplied E2E smoke source labels this as a known limitation. The sign-out dirty warning is therefore not normally available from that state. |
| Inline forms | **Confirmed registration gap.** Modal forms pass `dirty`; the inline Working Hours form and inline service-standard form do not use `useFormDirty`/modal registration. They will not contribute to the sign-out dirty check. |

### Minimum separately approved safeguard scope

Do not implement this in the present audit. A minimal plan, if approved, would likely touch:

1. `src/lib/ui/dirty-registry.js` — retain/export a shared dirty signal suitable for a browser `beforeunload` listener.
2. `src/components/layout/AppShell.js` or a small dedicated client hook — install one conditional `beforeunload` listener while any form is dirty; remove it when clean/unmounted.
3. `src/components/modals/Modal.js` plus modal form callers — gate Escape/backdrop close through a dirty-aware discard decision; ensure explicit Cancel behavior is intentional and consistent.
4. `src/app/calendar/WorkingHours.js` and `src/app/services/[id]/page.js` — register inline drafts if they should be protected.
5. A distinct route-transition mechanism/tests if browser Back or Next client navigation must be blocked. `beforeunload` does not block SPA transitions.

Browser `beforeunload` prompts are generic, browser-controlled, and not guaranteed for every mobile termination path; they warn but do not save data. Avoid stacking redundant prompts. Prefer a single guard that reflects actual dirty state, plus an explicit discard confirmation for modal close. Keep sign-out confirmation separate from modal discard confirmation.

## 6. Security review

| Security item | Assessment | Boundary / action |
|---|---|---|
| Access JWT in `sessionStorage` (Agent 3 SEC-01) | **Confirmed frontend design risk, not a confirmed vulnerability.** Any same-origin script can read it; no XSS sink was found in inspected `src/`. | Threat-model and transport redesign require backend/gateway approval. Keep short expiry and strict server verification; neither was verified here. |
| CSP/security headers (SEC-02) | **Confirmed absent from `next.config.js`; runtime absence unverified.** Another edge may add them. | Inspect actual response headers first. A policy/config change is outside current approval and may require framework compatibility testing. |
| Reset token in query (SEC-03) | **Confirmed URL persistence.** Possible referrer/log/history exposure is a realistic risk, but actual propagation/logging was not inspected. | Clear query after safe capture; verify referrer and log behavior with runtime/gateway owners. |
| UI role validation (SEC-04) | **Informational boundary.** Current UI rejects unknown role strings, but decoded claims are not signature-verified in the browser and guards do not protect API data. | Backend must verify token and permissions independently on every protected request. Backend was not inspected in this task. |
| Marker cookie without `Secure` (SEC-05) | **Confirmed low-impact hardening gap.** Marker indicates possible session presence; it is not the bearer or refresh token. Production transport is unknown. | Verify HTTPS-only deployment and set Secure when appropriate. Avoid implying the marker itself grants a session. |
| Vendored shared server dependencies (SEC-06) | **Confirmed dependency footprint, not an exploit.** Source guard test rejects direct server-library imports. | Optional package split belongs to shared-library owners and is outside frontend-only implementation. |
| No request timeout/abort (SEC-07) | **Confirmed reliability gap, not demonstrated security exploit.** | Add timeout/cancellation in a separately tested frontend API utility change. |
| Query length / “sanitization” (SEC-08) | `URLSearchParams` encoding is present. No query injection flaw found. Missing max length alone is not evidence of injection or DoS. | Backend must validate limits. Frontend input length is optional UX/traffic control, not the security boundary. |
| No client secrets / raw HTML sinks | Agent 3 reports no client secret, `dangerouslySetInnerHTML`, `innerHTML`, or `eval`; source search in this review also found none of those sinks. | Positive evidence is limited to inspected frontend source, not built bundles, runtime dependencies, or backend. |

No backend source was reviewed for this task. Any claim about JWT signature checks, refresh-token revocation, deactivated account access, office scope, CSRF, rate limits, password-reset single-use, or API authorization must be checked separately against gateway and service code/configuration.

## 7. Prioritized remediation table

| Priority | Severity | ID | Minimal action | Dependencies | Ownership / verification |
|---|---|---|---|---|---|
| P0 | Critical | — | No confirmed item | — | None identified from frontend evidence. |
| P1 | High | — | No confirmed item | — | No high-impact frontend failure was proven in this static review. |
| P2 | Medium | A4-01 | Complete Calendar tabs semantics and keyboard model | None | Frontend-only; component + browser/AT verification. |
| P2 | Medium | A4-02 | Remove reset token from URL after capture; verify referrer policy | Runtime response/referrer review | Frontend plus serving-boundary verification. |
| P2 | Medium | A4-03, A4-11 | Decide and implement dirty-form protection for dismiss/unload/forced exits; cover inline drafts | Product decision; determine SPA navigation requirements | Frontend-only; browser lifecycle and route tests. Separate approval requested. |
| P2 | Medium | A4-05, A4-06 | Add latest-request behavior to remaining filtered lists; decide account loading UX | None | Frontend-only; delayed-response tests. |
| P2 | Medium | A4-07 | Review client-readable token storage threat model | Identity/gateway contract | Frontend design plus backend approval; do not change contract here. |
| P2 | Medium | A4-08 | Verify actual CSP/security headers | Local/deployment header evidence | Runtime/deployment owner; change only if missing. |
| P2 | Medium | A4-12 | Plan shared authenticated layout separately as Phase 1.6 | Route-group/layout design | Frontend architecture phase, not a bug-fix bundle. |
| P2 | Medium | A4-14 | Improve mobile navigation and field-error associations | UX/accessibility decision | Frontend-only; keyboard and screen-reader validation. |
| P3 | Low | A4-15, A4-16 | Secure marker in HTTPS; add request timeout/abort | Serving scheme; API UX policy | Frontend-only except cookie transport assumptions. |
| P3 | Low | A4-17, A4-20 | Optional dependency, error-boundary, component, asset, styling, and test-harness cleanup | Measurement/owner decisions | Frontend or shared package owner. |

## 8. Roadmap by workstream

### 8.1 Already addressed

- **Phase 1.5A account search/request ordering:** source changes are present; retain the 300 ms debounce, individual filter dependencies, and request sequence. Runtime remains unverified. Follow up on loading state and unmount cancellation separately.
- **Phase 1.5A row-menu focus:** source focuses the trigger before action selection and has guarded fallback to Add Account for removed rows. Runtime remains unverified.
- **Earlier role-claim concern:** current `userFromClaims` validation exists and is covered by role/session unit-test source. Do not re-open as a current defect.
- **Earlier modal focus concern:** current modal contains focus, handles Escape when allowed, and restores focus. Do not re-open as a generic modal defect. Dirty dismissal is a separate unresolved issue.

### 8.2 Remaining frontend fixes

1. A4-01 Calendar tabs.
2. A4-02 reset-token URL cleanup.
3. A4-05 latest-request handling on other filter-driven lists and A4-06 account loading indicator decision.
4. A4-14 field error and mobile navigation accessibility improvements.
5. A4-16 request timeout/abort if product behavior calls for a bounded wait.

Keep each change focused and add its regression coverage; do not combine with the Phase 1.6 layout migration.

### 8.3 Dirty-registry/data-loss safeguards — separate approval

1. Decide whether dirty Cancel is an explicit discard or should ask for confirmation.
2. Add one dirty-aware modal dismissal rule for Escape/backdrop; do not double-prompt.
3. Add a conditional unload warning for registered dirty forms, documenting browser limitations.
4. Decide and implement separate Next/browser-history transition protection if required.
5. Register relevant inline forms (at minimum Working Hours and service standard) if the sign-out dirty warning is expected to account for them.
6. Decide how the sign-out affordance should remain reachable while a modal is open.

### 8.4 Phase 1.6 — shared authenticated layout planning

Treat A4-12 as a separate architecture phase: evaluate moving the signed-in shell/session guard into a shared route-group layout, establish a page-title contract, retain public routes outside the authenticated shell, and preserve role-aware navigation and page-level UI restrictions. Measure removal of the session-check flash and test direct navigation, refresh, back/forward, and role destinations. Do not bundle unrelated query, focus, or dirty-state changes.

### 8.5 Backend-dependent items requiring separate review

- Verify gateway signature, issuer, audience, algorithm, and expiry checks for all protected paths.
- Verify each backend route enforces role and office scope independently of frontend visibility.
- Establish the intended revocation window after logout, password reset, and account deactivation.
- Verify Identity refresh-cookie attributes, password-reset token single-use/expiry, and refresh behavior.
- Verify gateway/proxy logging and referrer handling for the reset-token URL.
- Verify backend bounds for search query parameters and service response sizes.

No backend finding is asserted in this frontend report.

### 8.6 Runtime verification and regression tests

When separately authorized and safe to run:

- **Accounts debounce:** mock `apiFetch`, type several characters within 300 ms, assert no intermediate request, then assert one request with final query.
- **Accounts ordering:** delay old and new filter responses in reverse order; assert only latest data/error is rendered. Confirm loading behavior while pending and after failure.
- **Accounts lifecycle:** trigger save, deactivate, reset, reactivate reloads; unmount with an in-flight request; check no visible stale state and no console error.
- **Row focus:** keyboard-open row menu, activate Edit/Reset/Deactivate, verify dialog focus; cancel/Escape and verify trigger focus; remove/filter the row and verify Add Account fallback only when focus is body. Repeat at mobile viewport and with page scrolling.
- **Dirty forms:** test clean/dirty modal, Escape, backdrop, Cancel, busy save, browser refresh, tab close, browser Back, in-app navigation, and session-expiration redirects. Confirm no duplicate prompts and clearly distinguish warning from persistence.
- **Calendar tabs:** Arrow/Home/End and click behavior, selected state, tab order, panel ID references, and screen reader announcement.
- **Reset link:** verify token removed from visible URL after capture, still submits correctly, and is absent from same-origin Referer where policy intends. Inspect gateway/access logs only through authorized procedures.
- **Security headers/cookies:** inspect HTTP response headers and cookies in the actual target environment; do not infer them from `next.config.js` alone.
- **E2E safety:** keep full-system smoke out of shared/valuable data unless it uses an isolated disposable database and guarantees cleanup. The current full-system path creates a service record.

## 9. Validation evidence and unverified behavior

| Validation | Evidence/status |
|---|---|
| Current source review | Performed for reports, account request logic, row-action menu, modal, dirty hooks, session/auth helpers, reset page, API utilities, selected list pages, package scripts, CI workflow, and test sources. |
| Agent 2 report | Missing. |
| `npm test` | 57/57 is reported by Agent 1 and referenced in the task brief, not independently run or verified in this audit. |
| `npm run lint` | No result provided or found; not run. |
| `npm run build` | No result provided or found; not run. Existing `.next` output/BUILD_ID is not treated as proof. |
| Runtime debounce behavior | **UNVERIFIED/BLOCKED.** Source inspected; no browser execution. |
| Runtime row-action focus/fallback | **UNVERIFIED/BLOCKED.** Source inspected; no browser execution. |
| Runtime dirty paths / session expiration | **UNVERIFIED/BLOCKED** except source-level dismissal/redirect mechanics. Browser Back/cache behavior is specifically unknown. |
| Runtime CSP/response headers/referrer/logs | **UNVERIFIED.** Deployment/edge and gateway logs were not inspected. |
| Backend authorization/session behavior | **Not reviewed in this frontend-only task.** Requires separate backend approval/review. |

## 10. Scope-compliance statement

This was a read-only audit and planning task. No application code, vendor library, test, environment, dependency, lockfile, backend, database, CI, or deployment setting was modified. No tests, lint, build, browser automation, services, migrations, or Git operations were run. The only created file is this requested audit document at `ccms-frontend-draft-frontend/FINAL_FE_AUDIT.md`.

## Next actions for approval

1. Approve a focused Calendar tabs accessibility fix and its browser tests.
2. Approve reset-token URL cleanup and runtime referrer/header verification.
3. Decide whether dirty modal dismissal, unload, route changes, inline forms, and modal sign-out reachability need a separate safeguard phase.
4. Approve latest-request protections for other list pages and an account loading-state decision.
5. Schedule Phase 1.6 shared authenticated layout as a separate workstream; obtain backend/runtime review for token and authorization questions.
