# FMS Calendar Schema V3 Integration Report

**Branch:** `codebase-for-deployment`
**Patch:** `0001-feat-calendar-send-FMS-calendar-schema-3-on-push-and.patch`
**Integration date:** 2026-11-11
**Integrated by:** Senior Software Engineer (Claude Sonnet 4.6)

---

## A. Executive Summary

FMS (Faculty Management System) locked its calendar contract as schema version 3 (`fms-cccms-calendar-candidate-v3-1`, faculty-ms #287 and #437). The old `cal-1.0` envelope is refused by FMS; schema 3 is now required for all FMS push and pull traffic.

This report documents the integration of the patch that:
- Introduces `buildFmsMessage` for FMS schema 3 payloads on **push** (sync queue)
- Introduces `listFmsDeclarations` for FMS schema 3 payloads on **pull** (snapshot endpoint)
- Removes the old `CAL_EFFECT_ENABLED` switch — FMS always receives `effect` now
- Gates all FMS traffic behind `FMS_TERM_ID` — nothing reaches FMS until it is set
- Preserves `cal-1.0` unchanged for SMS (the AUDIT queue)

**Overall outcome:** Integration successful. All 14 patch files integrated (12 by clean apply, 2 with manual conflict resolution). All 133 core-service unit tests pass. Safety tests (50) pass. Build succeeds.

---

## B. Original Patch Overview

| Metric | Count |
|---|---|
| Files added | 0 |
| Files modified | 14 |
| Files deleted | 0 |
| Main services affected | `apps/core-service` only |

**Main functionalities introduced:**

1. FMS schema 3 push payload (`buildFmsMessage`)
2. FMS schema 3 pull snapshot (`listFmsDeclarations`, watermark-based consistency)
3. FMS term gating (`FMS_TERM_ID`, `fmsTarget`, `inFmsTerm`)
4. Stable pull message IDs (`fmsPullMessageId`, SHA-256 UUID v5 derivation)
5. Removal of the EB5 `CAL_EFFECT_ENABLED` on/off switch
6. Updated default calendar window end date (`2026-12-12` → `2026-12-22`)

---

## C. Detailed File-by-File Changes

| File Path | Change Type | Changes Implemented | Reason |
|---|---|---|---|
| `apps/core-service/.env.example` | Modified | Removed `CAL_EFFECT_ENABLED=false`; added `FMS_TERM_ID=` and `CAL_ARTIFACT_REVISION=`; updated window comment | FMS term ID and artifact revision are now the config knobs instead of the effect switch |
| `apps/core-service/docs/CAL-1.0.md` | Modified | Added section 0 describing schema 3 contract (push body, pull response, `FMS_TERM_ID`, cutover note) | Documents the locked FMS contract for future reference |
| `apps/core-service/src/app/api/declarations/route.js` | Modified | Added `listFmsDeclarations` import; added `if (caller === 'FMS')` branch that routes to `listFmsDeclarations` | FMS keys now get schema 3 snapshot; SMS keys still get cal-1.0 |
| `apps/core-service/src/lib/calendar/declarations.js` | Modified (conflict resolved) | Replaced `toEngineEntry` import with `toExceptionDto`; introduced shared `snapshotOf` helper with watermark tracking; refactored `buildDeclarations` and `listDeclarations` to use it; added `listFmsDeclarations` with cursor-watermark consistency check; generalized `decodeCursor`/`parseQuery` | Schema 3 pull needs stable `messageId`, watermark snapshot consistency and FMS-specific field names (`fromDate`/`untilDate`) |
| `apps/core-service/src/lib/calendar/message.js` | Modified | Added `import { createHash }` from `node:crypto`; added `FMS_SCHEMA_VERSION = 3`; added `fmsTarget`, `inFmsTerm`, `fmsText`, `fmsInstant`, `fmsPullMessageId`, `buildFmsMessage`; removed `effectEnabled`, `sendableToFms`; updated `DEFAULT_WINDOW` end to `2026-12-22`; `buildEntry` now always includes `effect` (was conditional on the switch) | FMS schema 3 is a separate payload shape; removing the switch simplifies the model |
| `apps/core-service/src/lib/calendar/sms-snapshot.js` | Modified | Removed `effectOn: true` parameter from `buildEntry` call | `buildEntry` no longer takes `effectOn`; effect is always included for SMS now too |
| `apps/core-service/src/lib/calendar/sync.js` | Modified (conflict resolved) | Replaced `effectEnabled`, `sendableToFms` imports with `buildFmsMessage`, `fmsTarget`, `inFmsTerm`; rewrote `enqueueCalendarChange` to skip FMS when `FMS_TERM_ID` unset, filter dates by term, and build schema 3 payloads for FMS; preserved `kickOutbox`/`kickSync` import that was added after the patch base | FMS push must send schema 3; term-date filtering prevents out-of-term messages |
| `apps/core-service/src/lib/readiness.js` | Modified | Updated hardcoded date reference in readiness check label from `2026-12-12` to `2026-12-22` | Reflects the corrected FMS term end date |
| `apps/core-service/test/calendar-cal10.test.js` | Modified | Renamed suites for schema 3; rewrote EB3 assertion to verify full schema 3 envelope; updated EB4, EB5 assertions to use `declaration.*` paths; added tests for FMS term filtering, `FMS_TERM_ID` gating, and control-character sanitisation | Tests must assert the new payload shape |
| `apps/core-service/test/calendar-declarations.test.js` | Modified | Added `smsKey`; rewrote EB6 assertions for schema 3 response shape (`schemaVersion: 3`, `scope`, `watermark`, `totalCount`, `entries`); added tests for stable pull messageId, snapshot consistency (watermark 409), series ID, `FMS_TERM_NOT_CONFIGURED` 503, `from`/`to` alias, SMS cal-1.0 fallback | Tests exercise the new pull contract |
| `apps/core-service/test/calendar-helpers.js` | Modified | Added `FMS_TERM_ID = 'sms:ccms-test:term:2026-1S'` export; set it in `setupTestEnv` | All calendar tests that use `setupTestEnv` now have FMS active |
| `apps/core-service/test/calendar-sync.test.js` | Modified | Changed default holiday date from `2026-12-25` to `2026-12-08` (inside term); updated push assertions to use `declaration.*`; added assertion that `audit.state.received[0].body.schemaVersion === 'cal-1.0'`; changed second holiday date to `2026-12-09` | FMS must send schema 3; SMS must still send cal-1.0; dates must be inside the FMS term |
| `apps/core-service/test/critical-tt7.test.js` | Modified | Replaced EB5 "ONLINE not sent" assertion with schema 3 assertion (`schemaVersion: 3`, `declaration.effect === 'ONLINE'`) | EB5 behavior inverted: ONLINE is now always sent with its effect |
| `apps/core-service/test/office-schedule.test.js` | Modified | Changed `schemaVersion` assertion from `'cal-1.0'` to `3` in the FMS pull test | Pull now returns schema 3 |

---

## D. New Features and Functionalities

### D1. FMS Schema 3 Push (`buildFmsMessage`)

Every calendar change that falls within the FMS term is enqueued as a schema 3 message:

```json
{
  "schemaVersion": 3,
  "messageId": "<sync row UUID>",
  "entityId": "<exception_id[@date]>",
  "entityRevision": 1,
  "changeKind": "UPSERT",
  "sourceTimestamp": "2026-10-07T00:00:00Z",
  "scope": { "termId": "sms:campus:term:2026-1S" },
  "provenance": { "artifactRevision": "ccms-fms-calendar-v3", "synthetic": false },
  "declaration": {
    "occurrenceId": "<entityId>",
    "seriesId": "<exception_id>",
    "appliesTo": ["CLASSES", "WORK"],
    "scope": "CAMPUS",
    "interval": { "startsAt": "...", "endsAt": "...", "timeZone": "Asia/Manila", "wholeDay": true },
    "mode": [],
    "effect": "SUSPENDED",
    "entryType": "REGULAR_HOLIDAY",
    "date": "2026-10-07",
    "description": "Holiday",
    "officeId": null
  }
}
```

A `REMOVE` message carries `declaration: null`.

### D2. FMS Term Gating

Nothing is queued for FMS and the FMS pull returns 503 `FMS_TERM_NOT_CONFIGURED` until `FMS_TERM_ID` is set. `fmsTarget(env)` is null while unset; every code path that handles FMS checks this guard.

### D3. FMS Schema 3 Pull (`listFmsDeclarations` / `GET /declarations`)

FMS machine keys now receive a schema 3 snapshot with watermark-based consistency:

```json
{
  "schemaVersion": 3,
  "snapshotId": "ccms-calendar:2026-08-17:2026-12-22:42",
  "watermark": 42,
  "scope": { "termId": "...", "fromDate": "2026-08-17", "untilDate": "2026-12-22" },
  "totalCount": 7,
  "entries": [ ... ],
  "nextCursor": null
}
```

The `watermark` is the sum of all entry revisions. A cursor from an older watermark returns 409 `CALENDAR_SNAPSHOT_CHANGED` and FMS starts the read again from page one.

### D4. Stable Pull Message IDs (`fmsPullMessageId`)

A pull has no sync row to borrow its ID from, so every pull entry derives a deterministic UUID v5 from `ccms-fms-pull:<entityId>:<revision>:<changeKind>` via SHA-256. The same entity revision always yields the same message ID on every pull.

### D5. EB5 Switch Removal

The `CAL_EFFECT_ENABLED` on/off switch (EB5) is removed. FMS now always receives `effect`. FMS applies SUSPENDED entries and holds ONLINE entries for review — nothing is held back by CCMS.

---

## E. Modified Existing Functionalities

| Functionality | Before | After | Behavior preserved? |
|---|---|---|---|
| FMS push payload | `cal-1.0` (flat fields, no declaration nesting) | Schema 3 (nested `declaration`, `scope`, `provenance`, `sourceTimestamp`) | No — intentionally changed per FMS lock |
| FMS pull payload | `cal-1.0` envelope with `items[]` | Schema 3 with `entries[]`, `watermark`, `snapshotId`, `totalCount` | No — intentionally changed per FMS lock |
| FMS pull cursor | 2-part `[date, entityId]` | 3-part `[watermark, date, entityId]` | Existing cursors become invalid; FMS must start from page 1 |
| FMS pull query params | `from`/`to` | `fromDate`/`untilDate` (old names accepted as aliases) | Backwards-compatible via alias |
| SMS push payload | `cal-1.0` | `cal-1.0` (unchanged) | **Yes — fully preserved** |
| SMS pull (by term) | `cal-1.0` listing | `cal-1.0` listing (unchanged) | **Yes — fully preserved** |
| `effectEnabled` / `sendableToFms` | Exported from `message.js`, used in sync and declarations | Removed | No — EB5 switch superseded |
| `buildEntry` `effectOn` param | Conditional on switch | Removed; effect always included | Callers updated; SMS now always gets effect too |
| FMS queue filtering | Filtered ONLINE entries when switch off | Filters by term date window | Behavior changed intentionally |

---

## F. Architecture and Integration Flow

### Components involved

```
Browser / FMS / SMS
       │
  API Gateway (:8080)
       │  /api/calendar/*  →  core-service (:3003)
       │
  core-service
   ├── apps/core-service/src/app/api/declarations/route.js   ← pull endpoint
   ├── apps/core-service/src/lib/calendar/
   │   ├── message.js          ← payload builders (buildFmsMessage, buildEntry)
   │   ├── declarations.js     ← pull logic (listFmsDeclarations, listDeclarations)
   │   ├── sync.js             ← push queue (enqueueCalendarChange)
   │   └── sms-snapshot.js     ← SMS term snapshot (cal-1.0 unchanged)
   └── sync_log table          ← outbox for FMS (schema 3) and AUDIT (cal-1.0)
```

### Push flow (calendar change → FMS)

1. Super Admin creates/edits/removes a calendar entry via `POST|PUT|DELETE /exceptions`.
2. `enqueueCalendarChange` is called inside the same transaction.
3. `fmsTarget(env)` is called — if `FMS_TERM_ID` is not set, FMS is skipped entirely.
4. For each dated occurrence in the calendar window that is `inFmsTerm(target, date)`, a `buildFmsMessage` payload is inserted into `sync_log` as `PENDING`.
5. The sync dispatcher job (`POST /api/jobs/calendar-sync`) reads PENDING rows and POSTs them to `FMS_URL`.
6. AUDIT (SMS) always gets a `cal-1.0` message via `buildMessage`, plus a fresh term snapshot via `enqueueAffectedSnapshots`.

### Pull flow (FMS recovery → CCMS)

1. FMS calls `GET /api/calendar/declarations?fromDate=&untilDate=` with its machine key.
2. `requireMachineKey` validates the key and identifies `caller = 'FMS'`.
3. `listFmsDeclarations` is called; `fmsTarget` checks `FMS_TERM_ID`.
4. `snapshotOf` builds all dated entries in the range, computing the watermark.
5. If a cursor is supplied with a stale watermark, 409 `CALENDAR_SNAPSHOT_CHANGED` is returned.
6. Otherwise, the page is returned as schema 3. FMS follows `nextCursor` until null.

### Authentication flow

- Machine keys issued with `caller: 'FMS'` and scope `read-calendar` can call the pull endpoint and receive schema 3.
- Machine keys issued with `caller: 'SMS'` receive `cal-1.0` from the same endpoint.
- All other keys and user tokens are refused with 401.
- FMS keys cannot use `?term=`; that query is SMS-only (403 `TERM_QUERY_NOT_ALLOWED`).

---

## G. Database and Configuration Changes

### Database changes

No new migrations. The patch adds no new tables or columns. The existing `sync_log` table stores schema 3 payloads in its `payload` JSONB column alongside the existing cal-1.0 rows.

> **Important:** Rows already queued for FMS in cal-1.0 (`schemaVersion: 'cal-1.0'`) are **not converted**. They must be drained (dispatched or manually marked) before `FMS_TERM_ID` is set. Otherwise FMS may receive a mix of cal-1.0 and schema 3 messages and reject the old ones.

### New environment variables

| Variable | Required for FMS | Default | Purpose |
|---|---|---|---|
| `FMS_TERM_ID` | **Yes** | _(empty — FMS disabled)_ | FMS Academic Term ID from the FMS/SMS reference mapping (e.g. `sms:campus:term:2026-1S`). Nothing queued for or served to FMS until set. |
| `CAL_ARTIFACT_REVISION` | No | `ccms-fms-calendar-v3` | Message-format revision FMS records as provenance. Never change per deploy; FMS rejects the same entry revision arriving with a different value. |

### Variables removed

| Variable | Was | Action |
|---|---|---|
| `CAL_EFFECT_ENABLED` | Controlled whether ONLINE entries/`effect` were sent to FMS | Removed from `.env.example`; still harmless in `.env.local` files but ignored |

### Existing variables unchanged

`CAL_WINDOW_FROM` / `CAL_WINDOW_TO` now define the FMS term's date window (used for recurring-entry expansion and term-date filtering). The default changed from `2026-08-17..2026-12-12` to `2026-08-17..2026-12-22`.

---

## H. Security Considerations

| Area | Detail |
|---|---|
| Machine key caller check | Pull endpoint distinguishes `caller === 'FMS'` before routing to schema 3. Prevents SMS keys from receiving schema 3 accidentally. |
| FMS term validation | `listFmsDeclarations` validates that the requested date range lies entirely within the configured FMS term, preventing queries across unintended academic years. |
| Watermark consistency | Cursors carry the watermark they were cut at; a stale cursor returns 409, so FMS cannot accidentally read a split view across a concurrent edit. |
| Payload text sanitisation | `fmsText` strips control characters (U+0000–U+001F, U+007F–U+009F) from description fields, preventing injection via calendar entry descriptions. |
| FMS gating | `FMS_TERM_ID` unset → 503 on pull, skip on push. Misconfigured deployments never send garbage to FMS. |
| `artifactRevision` stability | The provenance field must not change per deploy; it is documented as such to prevent silent data-identity mismatches in FMS. |

---

## I. Testing Results

### Core-service unit and integration tests

| Test Suite | Tests | Result | Remarks |
|---|---|---|---|
| EB3: FMS schema 3 envelope | 10 | PASS | Full schema 3 envelope, term gating, control-character sanitisation |
| EB4: part-day end time | 4 | PASS | Interval now uses `startsAt`/`endsAt`/`timeZone`/`wholeDay` |
| EB5: effect (always sent) | 3 | PASS | ONLINE and SUSPENDED both sent; WORK carries empty effect |
| C42: one-office entries | 3 | PASS | |
| EB6: GET /declarations (FMS schema 3) | 10 | PASS | Watermark 409, stable messageId, paging, 503 without term |
| CC018 pushing to FMS and Audit | (many) | PASS | FMS schema 3 push; SMS keeps cal-1.0 |
| EB17 term snapshot for SMS | 7 | PASS | SMS unaffected |
| All other core-service suites | remaining | PASS | |
| **Total** | **133** | **PASS** | 0 failures, 0 skipped |

### Safety / migration guard tests

| Test Suite | Tests | Result |
|---|---|---|
| Runtime sync guards | 4 | PASS |
| Operations TT2 migration | 3 | PASS |
| Oversight TT2 migration | 1 | PASS |
| Other migration/fingerprint/guard suites | 42 | PASS |
| **Total** | **50** | **PASS** |

### Build

| Target | Result |
|---|---|
| `npm run lint --workspace=apps/core-service` | PASS (no warnings) |
| `npm run build --workspace=apps/core-service` | PASS |

---

## J. Issues Encountered and Resolutions

### J1. Patch conflicts in 3 files

**Problem:** `git apply --check` reported that `declarations.js`, `sms-snapshot.js`, and `sync.js` did not apply cleanly.

**Root cause:** The codebase had evolved beyond the patch's base commit. Specifically:
- `declarations.js` used `toEngineEntry` where the patch assumed `toExceptionDto`.
- `sync.js` had an additional `import { kickOutbox, kickSync } from '../outbox.js'` line not present in the patch base.

**Resolution:** Applied with `--3way` to auto-resolve 11 of 14 files, then manually resolved the 2 remaining conflict hunks:
- `declarations.js`: Used the patch's `toExceptionDto` + watermark logic; updated the import accordingly.
- `sync.js`: Used the patch's new `message.js` imports; retained the `kickOutbox`/`kickSync` import that is unrelated to this patch.

### J2. Test failures in files not touched by the patch

**Problem:** 3 tests in `calendar-exceptions.test.js` and `calendar-holiday-import.test.js` failed after integration because they assumed all calendar entries get FMS rows, which is no longer true for dates outside the FMS term.

| File | Line | Failure | Root cause |
|---|---|---|---|
| `calendar-exceptions.test.js` | 317 | Expected 2 sync rows (FMS+AUDIT), got 1 | Test used date `2027-07-01`, outside FMS term |
| `calendar-holiday-import.test.js` | 91 | Expected 2 sync rows, got 1 | Imported `2026-01-01`, outside FMS term |
| `calendar-holiday-import.test.js` | 188 | Expected 10 sync rows, got 5 | All 5 PH holidays are outside FMS term; only AUDIT rows queued |

**Resolution:**
- `calendar-exceptions.test.js:317`: Changed test date from `2027-07-01` to `2026-10-07` (inside the FMS term).
- `calendar-holiday-import.test.js:91`: Updated expected count from 2 to 1 with explanatory comment.
- `calendar-holiday-import.test.js:188`: Updated expected count from 10 to 5 with explanatory comment.

These are correct new-behavior fixes — the patch intentionally changed the queuing behavior.

---

## K. Deployment Requirements

### Before activating FMS schema 3

1. **Drain or invalidate old FMS cal-1.0 queue rows.** Any `sync_log` row with `consumer_system = 'FMS'` and `status IN ('PENDING', 'FAILED')` that carries a `cal-1.0` payload must be cleared before `FMS_TERM_ID` is set. Options:
   - Wait until all PENDING rows dispatch and are acknowledged/failed, then mark remaining FAILED rows as SUPERSEDED manually.
   - Directly: `UPDATE sync_log SET status = 'SUPERSEDED' WHERE consumer_system = 'FMS' AND status IN ('PENDING','FAILED');`

2. **Set `FMS_TERM_ID`** in `apps/core-service/.env.local` (local) or the deployment secrets (Vercel/hosted). Obtain the correct value from the FMS team — it looks like `sms:<dataset>:term:<native-id>`.

3. **Set `CAL_WINDOW_FROM` / `CAL_WINDOW_TO`** to the FMS term's date boundaries (e.g. `2026-08-17` / `2026-12-22`). The defaults match the current semester but should be explicit in production.

4. **FMS pulls the full term once.** After `FMS_TERM_ID` is set, FMS should perform one full pull of `GET /calendar/declarations?fromDate=<start>&untilDate=<end>` to hydrate its database.

5. **Leave `CAL_ARTIFACT_REVISION` unset** unless the message shape changes again. The default `ccms-fms-calendar-v3` is correct. Never change this value on a live FMS term once messages have been sent.

### Items that do NOT require a migration

No database migrations are needed. The `sync_log` table's existing schema accommodates schema 3 payloads in its `payload JSONB` column without changes.

### Staged rollout recommendation

1. **Dev/local:** Set `FMS_TERM_ID`, run `npm run mocks`, exercise the push dispatcher and the pull endpoint.
2. **Staging/QA:** Drain old FMS rows, set `FMS_TERM_ID` to the QA term, verify FMS mock or real FMS staging accepts the messages.
3. **Production:** Follow `docs/database-migrations.md` drain procedure; set `FMS_TERM_ID`; monitor `GET /api/sync/status` for FMS push errors.

### Items requiring FMS team confirmation

| Item | Status |
|---|---|
| `FMS_TERM_ID` value for production | **Needs FMS team** |
| Exact FMS Academic Term date range | **Needs FMS team** |
| FMS confirmation of schema 3 pull acceptance in production | **Needs FMS team** |

---

## L. Final Implementation Summary

### 1. Changes directly introduced by the patch (14 files)

| File | Type |
|---|---|
| `apps/core-service/.env.example` | Config updated |
| `apps/core-service/docs/CAL-1.0.md` | Docs updated |
| `apps/core-service/src/app/api/declarations/route.js` | FMS routing added |
| `apps/core-service/src/lib/calendar/declarations.js` | Schema 3 pull added |
| `apps/core-service/src/lib/calendar/message.js` | Schema 3 builder added; EB5 switch removed |
| `apps/core-service/src/lib/calendar/sms-snapshot.js` | Obsolete `effectOn` param removed |
| `apps/core-service/src/lib/calendar/sync.js` | Schema 3 push; term-date filtering |
| `apps/core-service/src/lib/readiness.js` | Date label corrected |
| `apps/core-service/test/calendar-cal10.test.js` | Tests updated for schema 3 |
| `apps/core-service/test/calendar-declarations.test.js` | Tests updated for schema 3 pull |
| `apps/core-service/test/calendar-helpers.js` | `FMS_TERM_ID` test constant added |
| `apps/core-service/test/calendar-sync.test.js` | Tests updated for schema 3 push |
| `apps/core-service/test/critical-tt7.test.js` | EB5 assertion updated |
| `apps/core-service/test/office-schedule.test.js` | Schema version assertion updated |

### 2. Additional changes made during integration

| File | Change | Reason |
|---|---|---|
| `apps/core-service/src/lib/calendar/declarations.js` | Import changed from `toEngineEntry` to `toExceptionDto` | Conflict resolution — patch assumed `toExceptionDto` already present |
| `apps/core-service/src/lib/calendar/sync.js` | Retained `kickOutbox`/`kickSync` import while replacing old `message.js` imports | These were added after the patch base and must be preserved |
| `apps/core-service/test/calendar-exceptions.test.js` | Test date changed `2027-07-01` → `2026-10-07` | Date was outside FMS term; FMS rows are now only queued for dates inside the term |
| `apps/core-service/test/calendar-holiday-import.test.js` (line 91) | Expected count 2 → 1 | `2026-01-01` is outside FMS term |
| `apps/core-service/test/calendar-holiday-import.test.js` (line 188) | Expected count 10 → 5 | All 5 PH holidays are outside FMS term |

### 3. Existing functionality preserved

- **SMS cal-1.0 push**: unchanged — `buildMessage` still produces cal-1.0.
- **SMS term snapshot (EB17)**: unchanged — `buildTermSnapshot` unaffected.
- **SMS pull (`?term=`)**: unchanged — SMS keys still receive cal-1.0 listing.
- **All non-calendar core-service functionality**: unchanged (offices, services, working-time engine, deadline engine, etc.).
- **All other microservices**: not touched by this patch.
- **API Gateway routing**: not changed.

### 4. Outstanding issues

None. All tests pass. Build succeeds.

### 5. Items requiring FMS team confirmation before production

- Exact `FMS_TERM_ID` value for the production FMS term.
- Confirmed FMS term date range for `CAL_WINDOW_FROM` / `CAL_WINDOW_TO`.
- Verification that production FMS accepts schema 3 from this implementation.
