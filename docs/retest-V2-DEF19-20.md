# Retest V2 / S8-11: DEF-19 (optional employee number) and DEF-20 (applies-to setting)

**Date:** 2026-11-24. **Commit tested:** `ae40be0` (the fixes `3bb969e` and `08aa866` are ancestors of it). **Environment:** local dev stack, not the QA stack. **Backend:** read only. **Nothing was saved to the real system:** every account save and setting change was answered inside the browser, so no account was created and no setting changed.

## Is the DEF-19 migration applied? (S8-19, read only)
The stack's Identity database (port 15433, 61 accounts) has `accounts.employee_no` nullable (`is_nullable = YES`), with the unique index still in place. So the migration is applied there. A second, older Identity database on this machine (port 5433, 4 accounts) still has NOT NULL; the stack does not use it. The same must be done on the QA / target database before QA runs M1-27.

## DEF-19 results (Super Admin, Accounts page)
| Check | Result |
|---|---|
| Label reads "Employee no. (optional)"; the field is not required, no asterisk | Pass |
| Account 1 saved with a blank number: the request is sent, no "required" message | Pass |
| Account 2 saved with a blank number: sent as well (AC1, FE side) | Pass |
| A refused duplicate (Identity answers `EMPLOYEE_NO_TAKEN`): "Employee number already in use" shows under the field, the form stays open (AC1, FE side) | Pass |
| A person with no number: list and details show nothing or "—", never "null" or "undefined" | Pass |

Note: the FE sends an empty text for a blank number; Identity turns empty text into "none" (read in `accounts.js`), so that is expected.

**What this does not prove:** that Identity really accepts two blank numbers and refuses a real duplicate. That needs a real save on a test database (QA). Read only, Identity's code does that (`NULL` is allowed many times under the unique index; a non-blank duplicate is a conflict), and its own tests cover it, but they were not run here.

## DEF-20 results (Super Admin, Calendar, Holidays)
The real setting is currently **on** (read from the server). The switch is shown only to the Super Admin.
| Check | Result |
|---|---|
| Turn off while entries remain: Core's refusal ("Existing class/work-specific entries must be reviewed...") is shown, the switch stays on | Pass |
| Turn off once Core accepts: the switch turns off and says "Class and office suspensions are off." (AC2, FE side) | Pass |
| The request sent is `{ applies_to_enabled: false }` | Pass |

**What this does not prove:** that Core now ignores removed entries when deciding. That is the BE fix `08aa866` (it counts only entries where `removed_at IS NULL`; read in `settings.js`). It needs a real run on a test database: add an entry, remove it, then turn the setting off.

## Suggested status
- DEF-19 and DEF-20: FE side **verified**; keep "Fix committed, retest pending" for QA's real-save run (M1-27, M3-32, M3-41) on the QA stack, after the migration is applied there.
