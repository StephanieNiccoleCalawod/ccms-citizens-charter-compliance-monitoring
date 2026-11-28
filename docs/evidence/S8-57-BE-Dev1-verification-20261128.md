# S8-57 / Row 35 - BE Dev 1 (Core)

Decision date: November 28, 2026 (Asia/Manila). The user selected: keep existing calendar feed formats unchanged; reason_category remains within CCMS. No partner payload extension is authorized or required for this item. This resolves the clarification raised during the Core review.

## Corrected backend requirement

Holiday types REGULAR_HOLIDAY, SPECIAL_NON_WORKING and LOCAL_HOLIDAY accept no user-entered reason and store HOLIDAY_PROCLAMATION. SUSPENSION requires a valid reason when created or converted from a holiday; an existing suspension may retain its saved reason on edit. Keep the database field and the existing cal-1.0 and FMS schema 3 serializers. Correct the backlog sentence claiming the outgoing feed already includes reason_category: current serializers omit it.

## Implementation reviewed

- apps/core-service/src/lib/calendar/exceptions.js: parser selects the automatic holiday reason, validates suspension reasons, prevents a holiday's automatic reason from carrying into a newly converted suspension, and maps reasonCategory into persisted entity values.
- apps/core-service/src/lib/calendar/holiday-import.js: existing holiday import also uses HOLIDAY_PROCLAMATION.
- apps/core-service/src/lib/calendar/message.js: cal-1.0 and FMS schema 3 retain their current shapes without a reason field.
- apps/core-service/test/s8-57-holiday-reason.test.js: five focused checks passed earlier in this session, including the type-conversion regression and unchanged cal-1.0 payload.
- apps/core-service/test/calendar-exceptions.test.js: existing integration assertions cover HTTP 201 plus a stored HOLIDAY_PROCLAMATION value and HTTP 400 plus a reason-category field message.

## Work delivered in this pass

| File | Change | Purpose |
| --- | --- | --- |
| scripts/s8-57-core-verify.mjs | Added local-only verification utility | Produces synthetic contract samples; optional fresh-test-database HTTP/persistence/queued-payload proof |
| docs/evidence/S8-57-Core-20261128/contract-samples.json | Generated from real serializers | Shows cal-1.0 and FMS schema 3 remain unchanged, without reason fields |
| This file | Recorded decision, corrected requirement and verification | BE Dev 1 handoff evidence |

No application behavior, API field, route, permission, feed serializer or production data changed in this pass. No migration is needed. The form's visibility rule (AC3) remains FE scope.

## Verification commands

From the repository root:

    node scripts/s8-57-core-verify.mjs
    node --test apps/core-service/test/s8-57-holiday-reason.test.js

For actual save/refusal and persistence evidence, supply a local test PostgreSQL URL via TEST_PG_URL and run:

    node scripts/s8-57-core-verify.mjs --with-db

The utility refuses non-loopback database hosts and never loads application .env files. It creates and drops a uniquely named synthetic database via the existing repository test harness. It does not send queued messages to partners. Generated output includes no authorization token.

## Results

- PASS: five existing focused tests in the preceding review in this session (0 failures).
- PASS: serializer verification utility generated the cal-1.0/FMS 3 samples and verified unchanged payloads when a reason is present internally.
- PASS: Core parser, serializer and focused-test ESLint check (exit 0).
- PASS: verification-utility ESLint using the Core config explicitly from the repository root (exit 0); node --check also passed. The first attempt from the service directory ignored the file outside its base path; the corrected root invocation checked it successfully.
- BLOCKED / NOT RUN: HTTP/database verification. Docker Desktop startup timed out and its Linux engine pipe was unavailable. Native PostgreSQL 18 initialization stalled during configuration probes and was cancelled before a server was started. A second data-directory attempt under C:/workspace was refused by the OS; no production fallback was used. Synthetic database and actual save/refusal assertions are provided in the verifier for a runnable local server.
- Hosted UI/screenshots and partner delivery: not performed by this local backend pass.

Status: Core implementation is present and the outgoing-feed decision is resolved. Five focused tests, real-serializer sample checks, syntax and lint passed. Local HTTP/database execution and hosted evidence remain unverified; do not mark the entire row fully accepted. No production data changed.

## Remaining verification once local PostgreSQL is available

    docker compose -f compose.test.yml up -d --wait
    node scripts/s8-57-core-verify.mjs --with-db

Expected evidence: local-http-and-database.json beside contract-samples.json. It records three holiday HTTP 201 responses with reason omitted from the input, persisted HOLIDAY_PROCLAMATION values, suspension HTTP 400/field message/no insert, holiday conversion refusal, a valid suspension save, and actual queued payloads with unchanged schemas. The temporary test database is dropped by the verifier. These are expected checks, NOT recorded passes from this run.
