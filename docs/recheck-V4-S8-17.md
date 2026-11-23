# Recheck of the 11/16 screen observations (S8-17)

**Date:** 2026-11-24. **Code:** commit `ae40be0` plus the fixes below (not committed yet). **Environment:** local dev stack, real Super Admin session, real reads. Writes were aborted in the browser. Where the real data has no example (a cancelled transaction, a very long ticket number), the answer was edited **in the browser only**, said below. Screenshots: `docs/evidence/S8-17/`.

| # | Observation | Outcome | Evidence | Widths checked |
|---|---|---|---|---|
| 1 | Working-hours time boxes at 1280 px | **Not reproduced** | The Add working hours form shows both time boxes full width (about 300 px each), no clipping, no overflow. `v4-hours-1280.png`, `-768.png`, `-360.png` | 1280, 768, 360 |
| 2 | Required-documents ticks lost while loading | **Not reproduced** | On Start a transaction, one document ticked, then Late entry switched on and the standard allowed to load: the tick stayed. | 1280 only |
| 3 | Per-staff table says "Staff member" | **Reproduces. Cause is the backend; now explained, not fixed** | For an Office Head the names come from the accounts list, which only a Super Admin may read (Identity code), and the KPI answer has no names. Every row says "Staff member". The table now says why. `v4-staff-table.png` | 1280 |
| 4 | "Syllabus Management System (SMS)" on Calendar | **Fixed** | Calendar says "Syllabus Management System (SCMS)" (S8-35). No "(SMS)" left. `v4-hours-1280.png` shows it under Connected systems. | 1280 |
| 5 | Long ticket numbers on Now Serving | **Reproduced at 360 px, fixed** | With a 44-character ticket number (browser only), the Now Serving ticket and two waiting tickets ran past the screen (page overflow at 360). They now wrap (`break-all`); 0 clipped, no overflow at 360, 768, 1280. `v4-now-serving-360.png` | 360, 768, 1280 |
| 6 | "Attach receipt" on cancelled transactions | **Reproduced, fixed** | The receipt form was shown whatever the status. One real transaction was shown as cancelled in the browser only: the form is gone and the page says "This transaction was cancelled, so no receipt can be attached." A receipt already attached would still show. `v4-cancelled-receipt.png` | 1280 only |
| 7 | "A PM decision is required" notice | **Not reproduced** | The text is not in the FE code. The only "PM decision" is a code comment in the Terms tab. | — |

## Changes (FE only)
- `ReceiptPanel.js` / `TransactionDetail.js`: `canAttach` is false for a cancelled transaction.
- `QueuePanel.js`: ticket numbers wrap and their containers can shrink.
- `kpi-home.js` / `KpiHome.js`: a note under the per-staff table when names are missing.
- Tests: `s8-17-staff-names.test.js`, `s8-38-accessibility.test.js`, and the receipt line in `transaction-list.test.js` now allows the new prop. 1,306 tests pass, lint has no errors.

## Not done
- AC2 for #2 and #6 was checked at 1280 px only; 360 and 768 for those two are still to do.
- #3 needs the backend: a way for an Office Head to read the names of the staff of their own office (see `needs-clarification.md`).
