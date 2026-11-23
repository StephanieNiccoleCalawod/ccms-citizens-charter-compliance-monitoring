# Questions for the PM (frontend work, Sprint 8)

One list, so it can be answered in one sitting. Each item says what is waiting, what the frontend does today, and what is recommended.
Write the answer under **Answer**. Items are grouped by what they block. Questions for the backend developers are at the end (section F).

How to read the status: **Built** means the frontend is done and tested. **Held** means it waits for the answer. **Removed** means it was
built and taken out until it is approved (a backup exists).

---

## A. Decisions that block or change work

### 1. Session limits: inactivity and maximum session (S8-33, S8-34 · D8-04, D8-17, D8-05)

**Status: Removed from the frontend. The backend has it, switched off.**

- The backend (Identity) already enforces an idle limit and a maximum session length for password sign-in, per role. It is off unless
  `SESSION_POLICY_ENABLED=true`. The proposed limits it carries are: Super Admin 15 min / 4 h, Office Head 20 min / 8 h, Office Staff
  30 min / 8 h, Executive 20 min / 8 h.
- The frontend part (the 60-second warning, tabs that agree, the sign-in notice, and a read-only Security & Sessions page) was built,
  tested and then taken out on request. The backup is `D:\integ capstone 1111\session-policy-fe-backup\` (new files and one patch).
- Gaps in the backend: Clerk sign-in is **not** covered ("follows the Clerk session"), and the browser cannot read its own role's limits
  (the policy endpoint is Super Admin only).

Questions:
- a. Are the numbers above approved (D8-04)? **Answer:**
- b. What should happen for Clerk sign-in (D8-17)? Today it has no server-side limit. **Answer:**
- c. Should a Super Admin be able to change the limits from Settings (D8-05)? That needs a new backend endpoint (bounded, versioned,
  audited). **Answer:**

Recommended: approve the numbers, decide Clerk first (it changes the design), keep the limits read-only until the team has used them.

### 2. Night school hours (S8-44 · D8-23)

**Status: Held. Nothing is built, on purpose.**

- Today an office has one opening and closing time per weekday and one optional lunch. A closing time that is not after the opening
  time is refused, so a window that crosses midnight cannot be stored. There is no second window in the backend.
- The ticket says not to invent evening hours, and the photo of the hours was unreadable.

Questions:
- a. What are the real hours, days and offices? **Answer:**
- b. Does the office simply close later (for example 8:00 AM to 8:00 PM)? If yes, **no build is needed.** **Answer:**
- c. Does any office work across midnight? **Answer:**

### 3. Lunch break and the Charter clock (S8-43 · D8-22)

**Status: Built (wording only). The compliance-clock rule was not touched.**

- The toggle now says "Frontline service stops during this break", and tells an office that keeps serving at noon, even with staff
  taking turns, to leave it off so its noon minutes count. The confirmation says whether the break is excluded from processing time.

Questions:
- a. Is that the approved policy for an office that serves at noon? **Answer:**
- b. Confirm: a staff meal break alone is **not** a legal pause of the Charter clock. **Answer:**

### 4. One glossary for the screens (S8-35 · D8-16)

**Status: Built (error messages, SCMS). Held (all renames).** The draft is `docs/ux-glossary-D8-16-draft.md`.

Questions (the table in the draft has the counts):
- a. "Start transaction" everywhere, including the "+ Add Transaction" button (today 5 against 4)? **Answer:**
- b. "Put on hold" for the action and **"On hold"** for the status. Today the status of a held transaction reads "Pending" (20 places),
  which is also the word used for sync and requests. **Answer:**
- c. "acknowledgement" (used 17 times, and the ticket writes "acknowledgment"): which spelling? **Answer:**
- d. "No access yet" or "Access pending" for the page and the menu? **Answer:**
- e. One sentence for every outage ("This service is temporarily unavailable. Please try again in a moment.") instead of the three
  wordings in use. **Answer:**
- f. **What does SCMS stand for?** The abbreviation is now SCMS in every sentence (defect #13), but the full name is still "Syllabus
  Management System" because nothing in the repository defines SCMS. **Answer:**

### 5. Settings and menu design (S8-13, S8-14, S8-36 · D8-20)

**Status: Built, waiting for approval.**

- `/settings` is now a hub of groups that link to the existing screens; the Transaction settings form moved to `/settings/transactions`.
- **Settings is now in every role's menu.** Before, Office Head and Office Staff had no menu item for it (CC027).
- The page a person lands on is now the **first menu item** for Office Head, Office Staff (Office Home) and Executive (Campus Home).

Questions:
- a. Keep **Holidays and suspensions** and **Accounts** in the hub? They are daily tasks and stay on their own pages either way; the
  proposal for S8-14 says only lasting configuration belongs in Settings. Recommended: remove those two items. **Answer:**
- b. The old `/settings` address used to be Transaction settings; it now opens the hub (one click from the old screen). Add a redirect for
  old bookmarks? **Answer:**
- c. May Office Head, Office Staff and Executive have a Settings item in the menu (read-only for them)? **Answer:**
- d. Is "the landing page is the first menu item" the rule you want? For Office Staff, should the Dashboard stay second, or sit below
  Transactions and Queue? **Answer:**
- e. Which three tasks should real staff be given in the walkthrough? The scripted ones are in `docs/ux-walkthrough-S8-36.md`. **Answer:**

---

## B. Analytics and the defense

### 6. Late-risk: the Escalate button (S8-25, finding F8-01 · D8-16)

**Status: Removed the false action. Held: a real one.**

- The old "Confirm Escalation" button said "Escalation logged. Follow-up notification queued." but sent nothing. There is no escalation
  endpoint in the backend. The button, its dialog and the message are gone; the row action is now "Review" and opens the transaction.

Question: do you want a **real, audited escalation** (it needs a new backend endpoint and a decision on who is notified), or is
"Review" enough? If Escalate is shown in the defense, the ticket says to raise F8-01 to P0. **Answer:**

### 7. "Overdue by 2 h 15 min" needs a field from the backend (S8-25)

**Status: The frontend is ready; the data is missing.**

- 46 of the 50 open transactions are overdue, and the screen used to show figures like "219700% used". It now says **Overdue** (and
  "Past the Charter time limit").
- To show **how long** it is overdue, the backend must send `overdue_working_minutes` (or `limit_minutes` with `elapsed_working_minutes`)
  for each item. It sends neither; `working_minutes_left` stops at 0.

Question: is "Overdue" without the hours acceptable for the defense, or should this be asked of the backend first? **Answer:**

### 8. Targets and refresh rules (S8-25 · R-05, R-08)

- The compliance trend chart is labelled "95% Charter Target". The ticket mentions a **100%** Charter target (R-05). Which is right? **Answer:**
- What is the live-refresh rule for the dashboards (R-08, M9-18)? Today they refresh every minute while the tab is visible. **Answer:**

### 9. Model figures in the defense (S8-09, S8-25 · D8-08, D8-09, D-08)

- The trained late-risk model (701 rows, 97 late cases) has accuracy 85%, precision 50% and **recall 20%**. The ticket says not to state
  accuracy figures in the defense unless the evidence (D-08) exists.
- A stale model (older than seven days) keeps its metrics in the database; the screen now shows **no metric** while the rules are scoring.
  The current model becomes stale on 2026-11-25.

Questions:
- a. May the figures be shown or quoted in the defense? **Answer:**
- b. Which data should the model be trained on: the current data, or the S8-08 seed (v3)? **Answer:**

### 10. Late-rate thresholds (Office Performance view)

- "Needs attention" is a late rate above 10%, "Delayed" above 20%, and a service with fewer than 5 completed transactions is "Too few to
  judge". These are the thresholds already in the code. Are they the business rule? **Answer:**

### 11. Days or minutes on the alert cards (Office Performance view)

- The Charter limit is shown in working time ("26 h 7 min"). The reference design showed "2 Working Days". Days need the length of a
  working day, which the calendar owns and the frontend does not have. Minutes and hours are accepted, or ask the backend for days? **Answer:**

### 12. Data that looks wrong

- One office ID has a transaction in analytics but is **not in the office list**, so its name cannot be shown. The Office Performance
  view shows "Unknown office" with a short ID; the older heatmap still shows just "Office". Clean the data, or accept? **Answer:**
- One forecast run is recorded as SUCCESS with **0 transactions counted and a 0.00 error**. This is the backend's data (see section F).

---

## C. Permission to verify

### 13. Real checks of settings changes (S8-15)

Reading the backend and the audit log shows that every settings write is Super Admin only and is audited. Two things could not be
proved without help:
- a. **Test accounts** (email and password) for an Office Head, an Office Staff and an Executive, to see the real 403 for each write.
  **Answer:**
- b. **Permission for one small change that is put back** (for example, switch one permission switch on and off), to see the new audit
  rows with who and when. **Answer:**

### 14. Walkthrough with real staff (S8-36)

The "three tasks without help" check needs real Office Head and Office Staff. Who and when? **Answer:**

---

## D. Pages that do not exist yet

- **Email and notification status** (S8-31): there is no screen that shows "Email queued" or "Email failed" for a transaction, so the
  glossary terms have nowhere to appear. Is it still planned for this sprint? **Answer:**
- **Security & Sessions** (S8-34): removed with item 1. It comes back when item 1 is decided. **Answer:**

---

## E. Process

- **Commits.** The frontend work is committed on the branch `feat/fe-dashboard-settings-hub-and-fixes` (five commits); later tickets
  (S8-25, S8-35, S8-36) are still uncommitted. Nothing was pushed. Two backend commits (S8-46, S8-49) are waiting on the remote branch;
  they do not conflict with the frontend work (checked, all frontend tests pass on top of them). When should the branch be pushed and
  merged into `codebase-for-deployment`? **Answer:**
- **A password was shared in the chat** for the real-system checks. It was used only on `localhost`, read-only, and not written to any
  file. It should be changed. **Answer:**

---

## F. For the backend developers (not the PM)

1. **503 must never write.** The screens say "nothing was saved" when the calendar, catalogue or receipt storage answers 503. Please
   confirm that 503 is always refused before anything is written (TT1, TT3).
2. **Lunch fixtures.** Engine tests at 11:59, 12:00 and 13:00 Asia/Manila on working days, holidays and non-working days, lunch on and
   off (S8-43, AC3). The existing test covers 11:00 to 14:00 only.
3. **Clerk and session limits.** Limits for the Clerk exchange (item 1b), and a way for the browser to read its own role's limits.
4. **Overdue time** per late-risk item (item 7).
5. **Transaction settings are not in the audit log yet.** The code writes `TRANSACTION_SETTINGS_UPDATED`, but no one has changed the
   settings, so it has not been seen in real data. Please make one change and confirm the row.
6. **A forecast run with 0 transactions** recorded as SUCCESS with 0.0000 error (item 12).
7. **New `calculations` metadata** (S8-46) and `main_reason_code` (S8-49) are returned now, but no screen shows them yet. Say if you
   want an explanation panel built on them.
8. **Heatmap names.** "On-Time Compliance by Office" still shows "Office" for the one unknown office ID.
