# Re-triage of the older defects #1 to #13 (S8-12)

**Date:** 2026-11-24. **Commit tested:** `ae40be0` plus the small change below (not committed yet). **Environment:** local dev stack, not the QA stack. **Who:** FE developer. **Backend:** read only. Every write was cancelled or aborted in the browser, nothing was saved.

**Limit of this note.** The DEFECTS sheet itself is not in the repository. I worked from the one-line names in the ticket (#1 duplicate receipt email, #2 staff creation password, #3 inactive in filters, #4 Charter reference optional, #8 Edit button, #10 backdated wording, #11 out-of-range standard, #12 required documents in Add Service, #13 names). For **#6, #7 and #9 the ticket gives no name**, so they were not retested. "Fixed" below means seen working on screen, not "a commit exists" (AC2).

| # | Defect | Outcome | Evidence | Owner / next |
|---|---|---|---|---|
| 1 | Duplicate receipt email | **Not retested here** | Belongs to S8-32 (BE sending). The FE already blocks a double click on every save (S8-37). | S8-32 owner |
| 2 | Staff creation password | **Changed by decision, not "passed"** | Add Account now says "Initial password (optional)" with "Password guidance: use at least 16 characters if you can" (Clerk sign-in mode). A real account was not created. | PM to confirm against the Clerk review §4.3 |
| 3 | Inactive records in filters | **Reproduced, fixed (FE)** | The real data has no inactive office or service, so one office and one service were marked inactive in the browser copy of the answers, and 155 options on 10 screens were read. Reports and Complaints filters offered the inactive office with no label. Both now show "(Inactive)". Transactions filter and the Add Transaction picker already labelled it and disabled it; the Queue picker only receives active offices (the public offices endpoint returns active ones). | Needs a real inactive office to confirm on QA |
| 4 | Charter reference optional | **Not reproduced (works)** | Add Service and the Add standard form: the field is not required, only "200 characters or fewer" is checked. | Close on QA retest |
| 5 | (already Closed) | Stays Closed | Not touched. | — |
| 6 | Not named in the ticket | **Not retested** | No description available. | QA to send the row |
| 7 | Not named in the ticket | **Not retested** | Same. | QA |
| 8 | Edit button not found | **Explained, not a defect as built** | Edit exists inside the row menu "Actions for <name>" on Services, Offices and Accounts, and is enabled. There is no standalone Edit button, so a tester looking for one will not find it. | Owner/PM: keep the menu, or add a visible Edit |
| 9 | Not named in the ticket | **Not retested** | Same. | QA |
| 10 | Backdated wording | **Changed by decision** | The page no longer uses "backdated". The box reads "This was already done." (S8-35 plain words). | PM to confirm the wording |
| 11 | Out-of-range standard | **Not reproduced (works)** | Add Service: 24 hours, 60 minutes and -1 working day are each refused with a message ("Hours must be a whole number from 0 to 23", "Minutes ... 0 to 59", "Working days ... 0 or more"); all zero is refused. The Add standard form uses the same rule. | Close on QA retest |
| 12 | Required documents in Add Service | **Not reproduced (works)** | Add Service shows "Required documents" (optional, names only). Saving a service with documents was not tried (it writes). | QA to save one on the QA stack |
| 13 | Names | **Not reproduced on 11 screens** | Dashboard, Transactions, Services, Offices, Accounts, Logs, Complaints, Queue, Reports, Late-risk, Campus: no ids, "Unknown", "null" or "undefined" where a name belongs. Known exception: the Office Performance view says "Unknown office" for the one transaction whose office is not in the catalogue (data issue, see the PM questions). | Data fix by BE / PM |

## What changed in the code (FE only)
- `ReportsPage.js` and `ComplaintsPage.js`: the office filter now labels an inactive office "(Inactive)". It is still selectable, because past reports and complaints of that office exist. Test: `s8-38-accessibility.test.js`.
- I first made the Queue picker do the same, saw it would mark every office "status unknown" (its list has no status field), and undid it. Nothing changed there.

## Not done
- A real inactive office, a real service with documents and a real account were not created (they write).
- #6, #7, #9 need their rows from QA.
- No defect here should be closed on this note alone; QA should repeat #3, #4, #11, #12 on the QA stack and decide #2, #8, #10.
