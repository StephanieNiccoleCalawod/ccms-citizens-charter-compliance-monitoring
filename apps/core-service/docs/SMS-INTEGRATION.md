# CCMS <-> SMS (SCMS) integration, as built

Source of truth for the SMS side: the SCMS code supplied (`apps/requirements-service`, `calendar.controller.ts`,
`calendar.repository.ts`, `term.controller.ts`), read on 11/06/2026. Where the 11/05/2026 integration guide differs from that
code, the code decides what works today, and the difference is listed in section 5 for the SMS team to confirm.

## 1. Flow 1: CCMS pushes the calendar (`SMS_SYNC_ENABLED=true`)

- `POST {SMS_URL}/api/v1/calendar/sync`, `Authorization: Bearer <SMS_SERVICE_TOKEN>`.
- Only **term snapshots** go to SMS (queue `AUDIT`). A new snapshot of the term is queued whenever an entry is added, corrected
  or withdrawn. Entry messages, term events and working hours are not sent to SMS (SMS does not need office hours, and its route
  rejects those messages). `SMS_SEND_ALL_MESSAGES=true` lifts this for a receiver that accepts everything.
- Body (built when the row is sent, so a retry is identical; `sync_id` is stable):

```json
{ "sync_id": "<uuid>", "schema_version": "cal-1.0", "snapshot": true, "timestamp": "2026-11-06T10:00:00.000Z",
  "term_code": "2026-1S",
  "entries": [ { "entity_id": "<id>", "revision": 1, "date": "2026-09-21", "name": "Holiday name",
                 "entry_type": "REGULAR_HOLIDAY", "appliesTo": ["CLASSES","WORK"], "effect": "SUSPENDED",
                 "interval": { "start": "2026-09-21T00:00:00+08:00", "end": "2026-09-21T24:00:00+08:00" } } ] }
```

- `snapshot: true` always: SMS withdraws every entry of the term that is not listed. A withdrawn entry is therefore **absent**;
  CCMS never sends a REMOVE entry (SMS would store it as a live entry).
- The term is identified by `term_code` only. No `academic_term` object is sent, because SMS owns the terms and would overwrite
  its academic year and semester with defaults. The term code is the term name in our term list; it must look like `2026-1S`,
  `2026-2S` or `2026-MIDYEAR` (`2026-MY` is sent as `2026-MIDYEAR`). Any other name fails the row with a clear message and nothing is sent.
- Reply: `result` ACCEPTED or REJECTED (`status` PROCESSED or ALREADY_PROCESSED). REJECTED, or an HTTP error, keeps the row
  FAILED with SMS's `reason` in `last_error`, and it is retried with the usual bounded retries.
- **401 from SMS**: the row stops retrying (attempts set to the maximum) and `last_error` starts with `KEY_REJECTED`. After fixing the key, requeue:
  `UPDATE sync_log SET status='PENDING', attempts=0, next_attempt_at=now() WHERE consumer_system='AUDIT' AND last_error LIKE 'KEY_REJECTED%';`
- Reading a row: `SELECT sync_id, status, attempts, last_error, reply FROM sync_log WHERE entity_type='term_snapshot' ORDER BY created_at DESC;`

## 2. Flow 2: academic terms from SMS (`SMS_TERMS_ENABLED=true`) - reader only

`src/lib/calendar/sms-terms-client.js`: `GET {SMS origin}/api/v1/terms` with the Bearer key; returns normalised terms
(`termCode`, `academicYear`, `semesterNumber`, `semesterLabel`, `displayLabel`, `startDate`, `endDate`, `status`). Nothing is
stored and no screen changed: caching into our term list waits for the PM's decision on who owns terms (Decisions Log H14), and
our term list has no term code, academic year or semester fields yet. **In the SCMS code supplied, this route accepts only a
signed-in SCMS user's token, so a machine key gets 401 until SMS adds a machine-key check for `read:terms`.**

## 3. Flow 3: SMS pulls the calendar from CCMS

`GET /api/declarations?term=2026-1S&cursor=&limit=` (through the Gateway, which lists `/api/declarations` for machine keys).

- Key: a machine key issued **to SMS** with scope `read-calendar` (`POST /api/machine-keys` with `caller: "SMS"`), `Authorization: Bearer ccms_mk_...`.
  FMS keys still work for `from`/`to` but get 403 on `?term=`. No key, a wrong key, a user token or the shared service key: 401.
- `term` is looked up in our term list (a term name that is an SMS term code, `2026-MY` accepted for midyear); unknown: 404 `TERM_NOT_FOUND`.
  `term` together with `from`/`to` is a 400.
- Same shape and paging as the FMS pull. Rotation: `docs/MACHINE-KEYS.md` (90 days, up to 7 days overlap, instant revocation).

## 4. Switches (all off by default)

`SMS_SYNC_ENABLED`, `SMS_TERMS_ENABLED`, `SMS_SEND_ALL_MESSAGES`. FMS behaviour is unchanged.

## 5. Differences found between the 11/05/2026 guide and the SCMS code supplied (to confirm with the SMS team)

| # | Guide says | SCMS code does | What CCMS does now |
|---|---|---|---|
| 1 | Entry type `SPECIAL_NON_WORKING_DAY` | Deadline engine only moves for `REGULAR_HOLIDAY`, `SPECIAL_NON_WORKING`, `LOCAL_HOLIDAY`, `SUSPENSION` | Sends `SPECIAL_NON_WORKING` (one line in `SMS_TYPE_MAP`) |
| 2 | Key `write:calendar` on the push route | No key check at all on `POST /api/v1/calendar/sync` | Sends the Bearer key; SMS must start checking it |
| 3 | `GET /api/v1/terms` with a `read:terms` key | Requires a signed-in SCMS user token | Reader built; 401 until SMS adds the machine-key check |
| 4 | Send REMOVE tombstones | Ignores `change_kind`; removes only what a snapshot leaves out; a REMOVE entry would be stored as live | Snapshot with the entry omitted |
| 5 | Part-day suspension has start and end | Does not store `interval`; a suspension acts as a whole day | Sends the interval anyway |
| 6 | SMS owns terms | Upserts the term row (dates, year, semester) from `academic_term` in a push and sets it ACTIVE | We send no `academic_term` |
| 7 | Pull `GET /calendar/declarations?term=` | No code that pulls from CCMS | Route ready; path and header to confirm |
| 8 | Acknowledge via `POST /sync/ack` | No call to `/sync/ack`; the reply to the push is the acknowledgement | The reply is read as the acknowledgement |
