# CC039 / CC040 / CC045: queue, queue wait at Start, proof of payment

Sprint 7 Wave 3. Spec: `CCCMS_SPRINT5-8_TECHNICAL_SPECIFICATIONS_11082026.md` §§8.5, 9.1, 9.3. Base: `origin/codebase-for-deployment` `dead57cd6b8cb6f56d1c3c4627d49168afcaa4b2`.

## CC039 — queue number without an account

### API (Operations; browser path is `/api/operations/...` through the gateway)

| Route | Who | Body / answer |
|---|---|---|
| `POST /api/queue/public/tickets` | anyone (gateway public path) | `{ office_id, priority_group? }` → 201 `{ ticket_no, office_code, office_name, lane, queue_date, issued_at, waiting_ahead }`; 400 by field (unknown fields such as `name`/`email` are refused); 429 + `Retry-After`; 503 when Core cannot confirm the office |
| `GET /api/queue?office_id=` | Office Staff/Head (own office, `office_id` optional), Super Admin (any office, `office_id` required) | `{ office_id, queue_date, now, grace_seconds, called[], waiting[] (call order), counts, queue_empty }` |
| `POST /api/queue/tickets` | same | `{ office_id?, priority_group? }` → 201, same sequence as the public page |
| `POST /api/queue/call-next` | same | `{ office_id? }` → `{ queue_empty, ticket, message }` (`ticket: null` when nobody waits) |
| `POST /api/queue/tickets/:id/skip` | same | `{ version? }` → `{ ticket }`; 409 `SKIP_TOO_EARLY` (`details.skippable_at`), `TICKET_NOT_CALLED` (repeated skip, or linked at Start), `TICKET_CHANGED` (stale panel), `TICKET_EXPIRED` (earlier day) |

Executive: 403 on every queue route. Pages: public `/queue/take` (link in the public header), staff `/queue` (menu item for operators).

### Rules
- Number: `<office_code>-<seq padded to 3>` per office **id** and per **server** Manila date, from 001. One upsert on `queue_sequences` in the same database transaction as the insert; `UNIQUE (office_id, queue_date, seq)` in the database.
- Office eligibility: the office exists in Core and is active (`GET /offices/:id` with the service key).
- Lanes: `priority_group` ∈ `SENIOR_CITIZEN | PWD | PREGNANT` → `PRIORITY`; only the lane is stored.
- Call order: all waiting PRIORITY before REGULAR; inside a lane `queue_order` ascending. `Call next` is one `UPDATE … WHERE ticket_id = (SELECT … FOR UPDATE SKIP LOCKED)`, so competing calls never claim the same ticket.
- Skip (K29): allowed when `now − called_at ≥ 3:00` (TEAM DEFAULT, `QUEUE_SKIP_GRACE_MS`). The ticket returns to WAITING with a new `queue_order` from the office/day counter (tail of its lane), keeping number, `issued_at` and lane; `called_at` is cleared and the next call records a fresh one. Checked under the ticket's row lock.
- Old days: only today's tickets are called, skipped or linked.
- Rate limit (public issuance only, before anything is read or allocated): shared `ccms-shared` limiter on Operations' `rate_limit_hits`, key `queue:issue:<clientIp>` (first `X-Forwarded-For` entry, forwarded unchanged by the gateway — the complaints/catalogue convention). **Default 10 per client address per 600 s**; `QUEUE_TICKET_RATE_LIMIT`, `QUEUE_TICKET_RATE_WINDOW_SECONDS`. A shared kiosk or campus NAT shares one address: raise the limit there.

### CC059 handoff (not built here)
`readNowServing(manager, officeId, { now })` in `apps/operations-service/src/modules/queue/tickets.js` returns `{ queue_date, current, next: [up to 3 display numbers] }` — display numbers only (no ids, lanes, times or anything about a person). `current` is today's most recent CALLED ticket, else the most recently SERVED one. CC059 adds a public `GET /api/queue/public/now-serving?office_code=` (resolve the code to the office id through Core, add the path to the gateway `PUBLIC_API.operations`, rate limit like the ticket route, `cache-control: no-store`) and the 5-second polling page `/queue/[officeCode]/now-serving`. Call order is defined once (`callOrderSql` / `sortForCalling`).

## CC040 — queue wait at Start

- `POST /api/transactions` accepts optional `queue_ticket_id` (the ticket's uuid). Absent/null/'' = the unchanged ticket-free Start (both fields stay null).
- Selectable: same office as the service, today's Manila date (server clock), status WAITING or CALLED. The Start form lists CALLED first ("called now"), then the waiting line; the selection clears when the service's office changes.
- Refusals (field error on `queue_ticket_id`, nothing saved): 400 `QUEUE_TICKET_INVALID` (unknown/other office), 409 `QUEUE_TICKET_USED` (already SERVED), 409 `QUEUE_TICKET_EXPIRED` (earlier day), 400 `QUEUE_TICKET_AFTER_START` (effective start earlier than issue — Start without the ticket still works).
- Measure: `queue_wait_minutes = floor((started_at − issued_at) / 60 000)`, both server instants; `started_at` is the stored effective start (request time or backdated start); `issued_at` is the original issue (Skip/recall never change it). 0:59 → **0 (a measured zero)**; null means no ticket.
- Atomic: ticket `FOR UPDATE` → checks → insert transaction with link + wait → ticket SERVED, one database transaction. A failed Start rolls the claim back. Backstops: `transactions_queue_ticket_uq` (partial unique), `queue_tickets_transaction_uq`.
- Analytics (TT2): new **optional** snapshot field `queue_wait_minutes` (int ≥ 0 | null). Absent = null, so older snapshots, outbox rows, replays and backfill pages stay valid; the producer leaves it out while null. No ticket id/number in analytics.
- KPI (`/api/analytics/kpis`) and reports: `queue_wait = { measured, average_minutes }` per bucket, placed by the Manila start date, null excluded, zero included, one decimal. CSV gains "Queue waits measured", "Average queue wait (minutes)" (empty cells for reports frozen before CC040). Compliance code does not read the field (AC2 tests compare results with and without it).

## CC045 — proof of payment

| Route | Answer |
|---|---|
| `GET /api/transactions/:id/receipt` | `{ receipt: { attachment_id, transaction_id, or_number, amount, receipt_date, content_type, size_bytes, uploaded_by, uploaded_at } \| null }` |
| `POST /api/transactions/:id/receipt` | multipart `file, or_number, amount, receipt_date` → 201 `{ receipt }`; 400 field errors; 413 `RECEIPT_TOO_LARGE`; 409 `RECEIPT_EXISTS` / `RECEIPT_UPLOAD_IN_PROGRESS`; 503 `RECEIPT_STORAGE_UNAVAILABLE` / `RECEIPT_NOT_SAVED` |
| `DELETE /api/transactions/:id/receipt` | `{ deleted: true, storage_purged }` |
| `GET /api/transactions/:id/receipt/image` | the bytes; `cache-control: private, no-store`, `nosniff`, CSP `default-src 'none'` |
| `GET /api/jobs/receipt-storage-cleanup` | cron (CRON_SECRET), daily 01:40 UTC; blocked at the gateway |

- Who (**decided 11/13/2026**, RBAC table "View the transaction list (and its receipt)"): the receipt follows the transaction. `canAccessReceipts` = `canAccessTransaction`: **Super Admin all, Office Head own office, Office Staff own records** (transactions they started). The same scope reads, uploads and deletes, as for Start and Complete. Executive: 403 on all four routes even though it may read the transaction (the Executive read rule is not used for receipts), and no panel. Anonymous: 401 at the gateway and at Operations. General transaction access is unchanged.
- How the earlier gap was found and closed: the first version was office-scoped, so a same-office colleague got 403 on `GET /transactions/:id` but 200 on the receipt routes. `test/cc045-receipts.test.js` › "CC045 access follows the transaction" now asserts the colleague (staff A2) gets **403 on the transaction and on receipt details, photo, delete and upload**, nothing changes and no view is audited; the Office Head of the office and the starter are allowed. `test/cc045-blob-storage.test.js` repeats the refusal with the Blob adapter (no Blob call is made).
- File: `.jpg/.jpeg/.png`, 1 B – 2 MiB (2,097,152 B) inclusive; bytes must start with the JPEG `FF D8 FF` or PNG signature **and** match the extension and declared type (`application/octet-stream` counts as undeclared). Storage key `receipts/<transaction>/<uuid>`, never from the file name, never returned.
- Details: OR number `^[A-Za-z0-9][A-Za-z0-9-]{0,29}$` stored as text (leading zeros kept); amount `numeric(12,2)` in PostgreSQL and a fixed two-decimal **string** in JSON (`"150.00"`, never a float) — the money convention introduced here; receipt date a real date not after today (Manila).
- Audit (shared outbox): `RECEIPT_UPLOADED`, `RECEIPT_VIEWED`, `RECEIPT_DELETED` on entity `transaction` (tracking number), with actor, office, time and `{ attachment_id, content_type, size_bytes }` only — never the image, key, OR number, amount or date. A view is committed before bytes are read.
- Failures: upload = reserve PENDING row → put object → confirm ACTIVE + audit in one transaction. Storage failure → row DELETED, 503. Confirm failure → object deleted again, row DELETED, 503. Only ACTIVE rows are ever served. Delete = DELETED + payment details cleared + audit in one transaction, then object delete; if storage fails the answer is still `deleted` (unreadable) and `storage_purged_at` stays empty. **Recoverable cleanup:** the cron job (and `runReceiptStorageCleanup`) deletes objects of DELETED rows not yet purged and of PENDING rows older than 15 minutes; idempotent. A stale PENDING row also stops blocking a new upload after 15 minutes.

### Storage provider: private Vercel Blob (confirmed by BE Dev 1, 11/13/2026, hosted development demo only)
- `RECEIPT_STORAGE=vercel-blob` selects `createVercelBlobStorage` in `apps/operations-service/src/modules/receipts/storage.js`, using `@vercel/blob@2.8.2` (exact pin, published 10/14/2026; 2.9.0 was too new) on the server only: `put(key, bytes, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: false })`, `get(key, { access: 'private' })` read into a buffer capped at 2 MiB, `del(key)`. No token is passed: the SDK uses the function's Vercel OIDC token with `BLOB_STORE_ID`, and falls back to `BLOB_READ_WRITE_TOKEN` only when no OIDC token is available. Neither value nor the returned blob URL is ever read, logged or returned; SDK failures become `StorageUnavailableError("Private Blob <ErrorName>")` → 503 `RECEIPT_STORAGE_UNAVAILABLE`.
- Without `BLOB_STORE_ID` or `BLOB_READ_WRITE_TOKEN` the adapter reports "no Blob store is connected" → upload and image 503 (details reads and deletes of existing rows still work). `memory` (tests) and `filesystem` (local dev) are kept and stay refused when `VERCEL` is set.
- Neon keeps the receipt row, OR number, amount, date and the audit outbox; Blob keeps only the bytes. The browser gets bytes only from `GET /api/operations/transactions/:id/receipt/image` (session on every request, `Cache-Control: private, no-store`).
- Cleanup stays one daily cron (`/api/jobs/receipt-storage-cleanup`, `40 1 * * *`), which fits Hobby's once-a-day cron limit.
- Automated tests use an SDK double (`test/cc045-blob-storage.test.js`); nothing in the test suite calls Vercel.
- **Real receipts are outside this demo and need the approved privacy notice.** Dummy images only.

### Operations environment settings (Vercel project `operations-service`)
| Setting | Value | Notes |
|---|---|---|
| `RECEIPT_STORAGE` | `vercel-blob` | Development/Preview environment of the demo only. |
| Blob store | create a **private** store; connect it to the Operations project for the same environment | Connecting adds `BLOB_STORE_ID` (and/or `BLOB_READ_WRITE_TOKEN`). Do not expose either as `NEXT_PUBLIC_*`. |
| OIDC | Project → Settings → Security → Secure backend access with OIDC federation **enabled** (default issuer mode) | Gives the functions `VERCEL_OIDC_TOKEN`; with `BLOB_STORE_ID` the SDK uses OIDC. If only `BLOB_READ_WRITE_TOKEN` is present the adapter still works with that token. |
| `CRON_SECRET` | existing | The cleanup job is one more daily entry in `vercel.json`. |
| Database | run migration `1794900200000-Cc045TransactionReceipts` (and CC039/CC040 ones) on the demo Neon branch before deploying Operations | Hosted migrations are BE Dev 1's step. |

### Hosted smoke test (dummy receipts only)
Use two small synthetic images (e.g. a 1×1 PNG and a solid-colour JPEG under 2 MB, no real receipt). `$OPS` = `https://<gateway-host>/api/operations`; tokens from signing in as each role in the browser (DevTools) or the demo accounts.
1. **Authorised upload** (Office Staff who started transaction `$TX`): `curl -s -X POST "$OPS/transactions/$TX/receipt" -H "Authorization: Bearer $STAFF" -F file=@dummy.png -F or_number=000123 -F amount=150 -F receipt_date=<today YYYY-MM-DD>` → 201, `or_number "000123"`, `amount "150.00"`; the JSON has no `vercel-storage`/`blob` URL.
2. **Authorised view:** `curl -s -D - -o out.png "$OPS/transactions/$TX/receipt/image" -H "Authorization: Bearer $HEAD"` → 200, `cache-control: private, no-store`, `content-type: image/png`; `out.png` equals `dummy.png`.
3. **Denied:** the same image request with no `Authorization` → 401 (gateway); with an Executive token → 403; with an Office Staff token of another office → 403; with an Office Staff token of the **same** office who did not start `$TX` → 403. Also `GET $OPS/transactions/$TX/receipt` as Executive → 403 while `GET $OPS/transactions/$TX` as Executive → 200 without receipt fields.
4. **Delete:** `curl -s -X DELETE "$OPS/transactions/$TX/receipt" -H "Authorization: Bearer $HEAD"` → `{"deleted":true,"storage_purged":true}`; the image request now → 404.
5. **Audit:** as Super Admin open the Logs page and find the transaction's tracking number → `RECEIPT_UPLOADED`, `RECEIPT_VIEWED`, `RECEIPT_DELETED` with actor, office and time; none shows the OR number, amount, date, storage key or a URL. (Delivery to Oversight is by the audit outbox: immediately after the response, else at the next outbox cron.)
6. **Store is private:** Vercel dashboard → Storage → the Blob store → its settings show **Private** access, and the Browser lists `receipts/<tx>/<uuid>` while the upload exists. Copy that blob's URL from the dashboard and open it in a private window with no Vercel session → it must be refused (not the image). Never paste the URL anywhere else. After step 4 the object is gone from the Browser list.
7. **Usage:** Vercel dashboard → (team) Usage → Blob (storage size, simple/advanced operations, data transfer) and Functions/Cron for the Operations project. Delete the dummy objects after the demo (step 4 or the cleanup job). If an upload answers 503 `RECEIPT_STORAGE_UNAVAILABLE`, check the store connection and `RECEIPT_STORAGE` in the Operations function logs (they show only `Private Blob <ErrorName>`).

## Migrations

| Service | Migration | Change |
|---|---|---|
| Operations | `1794900000000-Cc039QueueTickets` | tables `queue_sequences`, `queue_tickets` (+ checks, uniques, 2 indexes) |
| Operations | `1794900100000-Cc040QueueTicketLink` | FK `transactions_queue_ticket_fk`, check `transactions_queue_wait_ck`, partial unique `transactions_queue_ticket_uq` (columns already in the baseline; refuses to run if any row already has values) |
| Operations | `1794900200000-Cc045TransactionReceipts` | table `transaction_receipts` (+ FK, unique key, check, 2 partial indexes) |
| Oversight | `1794900000000-Cc040QueueWait` | `analytics_transactions.queue_wait_minutes integer` + check (table-level grants cover it) |

Each has `down`; table drops are guarded by `assertTablesEmptyBeforeDrop` / `assertColumnsEmptyBeforeDrop`.

## Rollout order

> **For Codex (release owner): the live order is fixed.** The owner asked for a direct push to `codebase-for-deployment` (no PR), and that push deploys. The new Operations code reads `queue_tickets` on every transaction list/detail read, so deploying it before its tables exist breaks transactions. Therefore, on the live database:
> 1. Oversight migration `1794900000000-Cc040QueueWait`.
> 2. The three Operations migrations, in order: `1794900000000-Cc039QueueTickets` → `1794900100000-Cc040QueueTicketLink` → `1794900200000-Cc045TransactionReceipts`.
> 3. **Then** the push to `codebase-for-deployment`, which deploys Oversight, Operations, Gateway and Frontend.
>
> Take a backup/snapshot before step 1 and rehearse steps 1–2 on a Neon branch first. Do not push before steps 1–2 have succeeded (or pause auto-deploy, push, migrate, then deploy).

Service order inside the deploy (why the order above is safe):
1. Oversight migration, then Oversight code (accepts the optional field, stores it, KPI/report figure).
2. Operations migrations (CC039 → CC040 → CC045), then Operations code (CC040 events carry the field only when measured; if Operations goes first, events with a wait fail at an old Oversight and retry from the outbox until step 1 is done).
3. Gateway (adds the one public path; must precede the public page going live).
4. Frontend.
Set `CRON_SECRET` (existing) — the new cron entry is in `apps/operations-service/vercel.json`. For the CC045 demo, connect the private Blob store and set `RECEIPT_STORAGE=vercel-blob` (see "Operations environment settings"); elsewhere leave it unset (uploads answer 503).

## Manual QA (synthetic data)
1. Signed out, `/queue/take`: choose an office, "Senior citizen" → `XXX-001`, Priority line. Again with no group → `-002`. Another office → `-001`. Repeat quickly from one browser beyond the limit → 429 message with a wait.
2. `/queue` as Office Staff: priority ticket is called first; Skip disabled with a countdown; after 3:00 Skip moves it to the end of its lane with the same number; Call next later shows a new call time. Empty queue → "No one is waiting".
3. Start a transaction with the called ticket → result shows "Queue ticket … waited N min". Start another without a ticket → no queue fields. Try a used ticket → field error at the picker.
4. Reports: generate for the office/period → "Queue wait" column; KPI home shows "Average queue wait". Open an older report → "-".
5. Transaction detail as Office Staff/Head/Super Admin: attach a dummy JPEG/PNG with OR `000123`, amount `150` → shows `000123`, ₱150.00; View photo; Delete. As Executive: no Proof of payment section; direct `GET …/receipt` → 403.

## Known failures outside this work (follow-up)
Codex prompt: `CCMS\CCCMS_CC040_FOLLOWUP_AC4_AND_RATE_LIMIT_KEY_CODEX_PROMPT.md`. Both reproduce on base `dead57cd6b8c`.
- **`test:integration` › `analytics-feed` AC4: fix in this candidate (test only).** Since CC056 a staff hold needs `STAFF_HOLD_RESUME`. The test never turns it on, so the hold returns 403 `SWITCH_OFF` and the backfill-convergence assertions never run. Fix: enable the switch in the test with `setSwitchGate`, plus an AC4 assertion for `queue_wait_minutes`. Until then, CC040's effect on replay and convergence is not covered by AC4 (the Oversight CC040 tests do cover version precedence).
- **`test:safety` › Oversight "migrate:run matches db:sync": separate change after this candidate.**
  - Cause: `1794600000000-Cc032Complaints` names the key `rate_limit_hits_pkey`; entity sync names it `PK_d392e81d922afbaed7efb3f1184`. The CC040 column and its check match exactly.
  - The separate Oversight migration `1794900100000-Cc032RateLimitKeyName` renames `rate_limit_hits_pkey` to `PK_d392e81d922afbaed7efb3f1184`. It accepts a primary key already using the target name and refuses an unexpected name or definition.
  - Release: runs after `Cc040QueueWait`, as its own Oversight step outside the fixed CC039 → CC040 → CC045 live order. No runtime impact.
- Also on the base, files untouched here:
  - The Identity revert-order assertion expects `Cc046TrimmedPosition`.
  - Four Frontend unit tests check `late-risk/page.js` and `transactions/[id]/page.js`.
  - Oversight lint: two unused imports in `test/complaints.test.js`.
