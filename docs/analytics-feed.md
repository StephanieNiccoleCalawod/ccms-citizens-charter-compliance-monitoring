# Analytics event feed, Operations to Oversight (Sprint 5 TT2)

Spec 2.2; decisions K14, K16, K28. Operations sends a complete, privacy-safe snapshot of a transaction to Oversight after
every lifecycle change, and Oversight keeps the latest snapshot per transaction in `analytics_transactions`. A backfill
loads transactions that existed before the feed. This is the data source for the later KPI, reports, Insights and model
work. **TT2 does not move forecasts, late-risk, reports or KPIs to Oversight**; the forecast still runs in Operations.

```
Operations                                                            Oversight
 start/hold/resume/complete/result/cancel/auto-close
   └─ same DB transaction: business UPDATE + analytics_event_version+1 + analytics_outbox row
 after the response / GET /api/jobs/analytics-outbox (CRON_SECRET)
   └─ dispatchAnalyticsOutbox ── POST /api/analytics-events (x-service-key, ≤500) ──▶ validate all ─▶ conditional upsert
 GET /api/transactions/analytics-export (x-service-key) ◀── backfill pages ── GET /api/jobs/analytics-backfill (CRON_SECRET)
                                                                             scripts/analytics-backfill.js (CLI)
```

## The contract

One module, `packages/ccms-shared/src/analytics.js`, defines the envelope, the snapshot fields (types, enums,
nullability), the ingest batch and export page shapes, the version policy, the validators, the snapshot mapper, the
cursor and the seed rule. The producer, export, ingest endpoint and backfill all use it. Read its header comment for
the full field table.

Envelope (fictional IDs):

```json
{
  "event_id": "5f1c8a52-0b7e-4d0e-9a51-3c1f2b7d9e01",
  "event_type": "TRANSACTION_RESULT_COMPUTED",
  "schema_version": 1,
  "occurred_at": "2026-10-06T02:40:00.000Z",
  "snapshot": {
    "transaction_id": "0f000000-0000-4000-8000-000000000001",
    "tracking_no": "PUP-REG-20261006-0001",
    "office_id": "0a000000-0000-4000-8000-000000000001",
    "service_id": "0b000000-0000-4000-8000-000000000001",
    "service_code": "PUP-REG-TOR-001",
    "classification": "SIMPLE",
    "client_type": "STUDENT",
    "standard_days": 0, "standard_hours": 1, "standard_minutes": 0,
    "started_at": "2026-10-06T02:00:00.000Z",
    "ended_at": "2026-10-06T02:40:00.000Z",
    "status": "COMPLETED",
    "elapsed_working_minutes": 40, "is_compliant": true, "variance_minutes": -20,
    "held_minutes": 0,
    "is_backdated": false, "started_outside_hours": false,
    "registry_status": "NONE", "registry_miss_reason": null,
    "outcome": "GRANTED",
    "started_by_user_id": "0c000000-0000-4000-8000-000000000001",
    "ended_by_user_id": "0c000000-0000-4000-8000-000000000001",
    "counter_id": null,
    "event_version": 3
  }
}
```

Ingest batch: `{ "events": [envelope, ...] }` (0–500 events, body ≤ 1 MiB) → `200 { "accepted", "applied", "ignored" }`.
Export page: `{ "schema_version": 1, "items": [snapshot, ...], "next_cursor": "<opaque>" | null }`.

### Source-to-payload mapping (Operations `transactions`)

| Snapshot field | Source column | Notes |
| --- | --- | --- |
| `classification` | `service_classification` | copied at Start |
| `standard_days/hours/minutes` | `standard_duration_days/hours/minutes` | copied at Start |
| `started_by_user_id`, `ended_by_user_id` | `started_by`, `ended_by` | staff **account IDs** only (K28); never names or positions |
| `elapsed_working_minutes`, `is_compliant`, `variance_minutes` | same | all null while pending; never turned into 0/false |
| `outcome` | `outcome` (CC050) | null on rows that never recorded one |
| `registry_status`, `registry_miss_reason` | not stored yet (CC044 is not built) | always `NONE` / null; the mapper uses persisted columns when they exist (add them to `ANALYTICS_SOURCE_COLUMNS`) |
| `event_version` | `analytics_event_version` | see below |
| everything else | same name | |

Never sent: client reference, email, name, student number, registry student number, every free-text reason/note
(backdate, hold, cancel, disapproval, registry note), staff names/positions, IP addresses, service/office names, receipt
fields. The mapper copies field by field; the validators reject unknown properties at every level.

### Version policy

`transactions.analytics_event_version` (default 0) is used only by this feed, not by the optimistic lock (`version`).
`recordAnalytics` increments it and reads the row back in the same database transaction as the change (the row lock
is already held), so versions of one transaction strictly increase in commit order. Rows from before TT2 export as 0;
their next event is 1. Oversight keeps the highest version; equal/lower versions are complete no-ops. Same
transaction + same version + different content in one batch → `400 CONFLICTING_DUPLICATE` (cannot be produced:
`UNIQUE (transaction_id, event_version)` in `analytics_outbox`); against a stored row, the stored row stays.

### Events per code path

| Path | Events (versions) |
| --- | --- |
| Start | `STARTED` (n+1) |
| Backdated start already completed (CC026) | `STARTED` (1) and `COMPLETED` (2) in one transaction, both carrying the stored row (status `COMPLETED`); then `RESULT_COMPUTED` (3) when Core answers |
| Hold / Resume | `HELD`, `RESUMED` (resume carries the persisted `held_minutes` total) |
| Complete | `COMPLETED` (result null, outcome as recorded) |
| Result computed (right away or by `compute-pending`) | `RESULT_COMPUTED`, built from the updated row |
| Cancel / Auto-close | `CANCELLED`, `AUTO_CLOSED` (`ended_at` stays null) |

## Delivery (Operations, consumer ANALYTICS)

`analytics_outbox` is separate from `audit_outbox`: separate rows, leases, retries, job and failure state.
`dispatchAnalyticsOutbox` claims ≤500 due rows (`FOR UPDATE SKIP LOCKED`, fresh `lease_token`, `lease_until` = now + 120 s),
POSTs them with a 10 s timeout, and marks them delivered only on a 2xx whose `accepted` equals the number sent, and only
while it still holds the lease. Failures release the lease and back off (5 s doubling, max 1 h) with a short `last_error`
(never a body). A `400` batch retries at most 10 individual events within a 20-second invocation budget, then releases
the remaining events for another run. Claims prioritize due time so deferred events cannot be starved by rejected
events in backoff. The exponential retry delay is capped before exponentiation, including after thousands of failures.
Lost responses are safe (the receiver ignores versions it
has). Destination: `LOGS_SERVICE_URL` (Oversight, with or without `/api`) + `SERVICE_KEY`; never the gateway.

Triggers: after every change (`kickAnalytics`, independent of `kickOutbox`) and the run-once recovery route
`GET /api/jobs/analytics-outbox` (`Authorization: Bearer $CRON_SECRET`). **TT2 does not add it to `vercel.json`.**

## Oversight

- `POST /api/analytics-events`: service key checked first (a user token never suffices; 401 otherwise), body ≤ 1 MiB
  (413), whole batch validated before any write (400), then one transaction with one statement:
  `INSERT … ON CONFLICT (transaction_id) DO UPDATE SET <all fields> = EXCLUDED.<field> … WHERE EXCLUDED.event_version >
  analytics_transactions.event_version`. A batch is first reduced to the highest version per transaction and written in
  `transaction_id` order. `is_seeded` is derived on receipt: the final dash-separated part is exactly four digits in
  9001–9999 (K16). Tracking numbers and `tracking_sequences` are never touched.
- Runtime role `ccms_logs_writer`: SELECT, INSERT, UPDATE on `analytics_transactions` and `analytics_backfill_state`;
  `ccms_oversight_app`: SELECT on `analytics_transactions`. No DELETE/TRUNCATE. `audit_log` grants are unchanged.

## Export and backfill

`GET {Operations}/api/transactions/analytics-export?limit=1..500&cursor=` (service key only): every transaction in every
status, ordered by the immutable `transaction_id`, opaque validated cursor (`{"v":1,"after":<uuid>}` base64url),
`next_cursor: null` on the last page. Unknown parameters are 400. It only reads.

Consistency: each page is one read. A row updated after its page was read is also in the live outbox with a higher
version, which wins. A row inserted behind the cursor during a pass is not in that pass, but its insert wrote a
`STARTED` event in the same transaction, so the live feed delivers it. Every row present when a pass starts is visited.

Backfill (`apps/oversight-service/src/modules/analytics/backfill.js`): one lease row (`analytics_backfill_state`), each
page's upsert and new cursor committed together while the lease is held, `OPERATIONS_SERVICE_URL` (with or without
`/api`) + `SERVICE_KEY`. Hosted job budget: 20 pages × 500 or ~20 s (checked before each fetch; 15 s fetch timeout),
then the cursor waits for the next invocation. A completed pass resets the cursor; the next run starts a new pass.

- Manual job: `curl -H "Authorization: Bearer $CRON_SECRET" https://<oversight>/api/jobs/analytics-backfill` (repeat until
  `pass_completed: true`; `ALREADY_RUNNING` means another run holds the lease).
- CLI (from `apps/oversight-service`): `npm run analytics:backfill` (whole pass), `-- --max-pages=N`, `-- --reset` (new pass
  from page 1), `-- --page-size=N`. A hosted database needs `DB_TARGET=hosted` and `--confirm=<database>`.
- Recovery: a failed page leaves `last_error` (`Operations responded 503`, `… could not be reached`, `… invalid page`) and
  the last committed cursor; rerun to resume. A crashed run's lease expires after 120 s. To start over, `--reset`.
  Reruns are idempotent (same count and content).
- The backfill sends no audit copies or email, pushes nothing to FMS/SCMS, seeds nothing and changes nothing in Operations.

## Gateway

`analytics` and `reports` → `LOGS_URL` (like `catalogue`/`calendar` → Core); no report/KPI endpoint exists yet. Blocked
for every alias of the target service, case-insensitively and after percent-decoding: `/api/analytics-events` (all
methods), `/api/audit-events` (writes), Operations `/api/transactions/analytics-export` (all methods, GET/HEAD included),
plus the existing `/api/jobs` and `/api/internal`. Blocking happens before the token check; a token or a forwarded
service key cannot unblock it. Future browser analytics reads go through the gateway with a token and service-side RBAC.

## Schema (numbered migrations)

| Service | Migration | Change | Revert |
| --- | --- | --- | --- |
| Operations | `Tt2AnalyticsOutbox1794355200000` | `transactions.analytics_event_version integer NOT NULL DEFAULT 0`; `analytics_outbox` with PK `event_id`, `UNIQUE (transaction_id, event_version)`, values CHECK, partial pending index | refused while the outbox has rows or any version ≠ 0, unless `CCMS_ALLOW_DATA_LOSS=Tt2AnalyticsOutbox1794355200000` |
| Oversight | `Tt2AnalyticsTransactions1794355300000` | `analytics_transactions` (+ values CHECK, 3 indexes), `analytics_backfill_state`, the grants above | refused while either table has rows, unless `CCMS_ALLOW_DATA_LOSS=Tt2AnalyticsTransactions1794355300000` |

Both are additive and refuse incompatible or partial pre-existing objects (frozen contracts in
`migrations/tt2-analytics-schema.json`). No cross-database keys. Earlier migrations and baselines are unchanged.

## Proposed rollout (not performed by the implementation)

1. Fresh hosted backups of Operations and Oversight; rehearse both migrations on copies (`migrate:show`, `run`, rerun, check grants).
2. Oversight first: migration (as the schema owner), then deploy with `OPERATIONS_SERVICE_URL`, `CRON_SECRET`, `SERVICE_KEY`.
   Check `POST /api/analytics-events` answers 401 without the key and `{accepted:0,…}` for `{events:[]}` with it.
3. Operations: migration, then deploy. Events from that moment are delivered; if Oversight is not ready they wait in the outbox
   and retry (the outbox bridges the window). Do not deploy Operations code before its migration (the producer writes the new column/table).
4. Backfill after both are live: CLI or repeated job calls until `pass_completed`; run a second pass and compare the row count
   with `SELECT count(*) FROM transactions` in Operations and the content checksums. Do not import seed datasets as part of this.
5. Decide separately whether to schedule `/api/jobs/analytics-outbox` (Operations) and `/api/jobs/analytics-backfill` (Oversight).

Compatibility: if Operations is rolled back to pre-TT2 code, the extra column and table are ignored (no writes); events
already in the outbox stay until delivered. Oversight can be rebuilt at any time by `--reset` + a full backfill.
