# S8-53: per-office past-transaction permission

Implemented locally November 24, 2026 (Asia/Manila), Operations and Core only.

## D-AC-5 decision supplied by user

The supplied decision screenshot specifies: per office only; default off for every office; Super Admin switches it on per office and every change is logged; backdated records keep their required reason and flag. Its rationale explicitly says blocking Super Admin or adding a second approval is not needed. Accordingly, Super Admin is exempt from the office permission check; Office Head and Office Staff must have office permission. No second approval flow was added.

## Backend contract

Core adds `offices.allow_backdated_transactions boolean NOT NULL DEFAULT false`. The same default is defined in the Office entity. Both existing and new offices start off after migration.

Authenticated office list/detail responses include `allow_backdated_transactions`. The existing trusted service-key office-detail endpoint exposes it to Operations. The reference-data GET remains available to existing readers; only Super Admin can change the setting.

```http
PATCH /api/offices/{officeId}
Authorization: Bearer <Super Admin access token>
Content-Type: application/json

{"allow_backdated_transactions": true}
```

Through the gateway, use `/api/catalogue/offices/{officeId}`. Response: `200 { "office": { ...office fields, "allow_backdated_transactions": true } }`. Body accepts exactly the boolean setting, not additional office identifiers or unrelated edits. Non-Super Admin callers receive 403; malformed values receive 400; missing offices receive 404.

Changes lock the office row and update the setting and audit outbox in one transaction. Audit action: `OFFICE_BACKDATE_PERMISSION_CHANGED`, including actor, office, old/new values and IP. Repeating the current value is a no-op with no extra change audit. Audit failure rolls back the setting change. Existing office-create/update endpoints cannot silently set the new permission from caller input.

## Operations enforcement

- For an explicitly supplied past start, Operations first resolves the service's actual office and checks the caller's office scope, then asks Core for that office's current permission before saving anything.
- A manually supplied past end time on completion uses the same permission check, preventing late entry through the completion path.
- Office Head/Staff need an active office with an explicit `true`. Missing permission from an older Core means off. A forged permission in the transaction body is ignored.
- Denied response: **403 `OFFICE_BACKDATE_NOT_ALLOWED`**, message **“This office is not allowed to record past transactions. Please ask the Super Admin.”**
- Unavailable, malformed, or wrong-office permission response: **503 `OFFICE_BACKDATE_PERMISSION_UNAVAILABLE`**; the transaction is not saved/completed.
- Super Admin skips the office-permission lookup. It still needs a valid timestamp, required backdate reason and all other transaction validations. Backdate flags/audits remain.
- Staff's existing `STAFF_BACKDATE` switch remains an additional requirement; enabling an office does not bypass that switch.
- Live start/completion calls skip the new lookup and retain existing behavior. No permission cache was added.

The check uses the authoritative Core value at lookup time. As with other cross-service checks, it does not lock Core's office row through the subsequent Operations transaction.

## Verification

- **8 focused tests passed**: default-off schema/migration contract; strict boolean input; Super Admin-only change; same-transaction audit and rollback; Office Head/Staff permission; Super Admin exemption; malformed/unavailable Core and inactive offices.
- **16 database-backed tests passed**: new Core HTTP/audit check plus Operations disabled-office/forged-input/live-entry/admin/outage/past-end cases and existing CC026 backdated entry regressions.
- Targeted ESLint passed for changed implementation and test files in both services. Diff whitespace check passed.
- Existing Operations test offices now explicitly opt in for legacy allowed-backdate scenarios. New denial tests explicitly turn the setting off. Production defaults remain off.

Focused command from repository root:

```powershell
node --test apps/core-service/test/s8-53-office-backdate.test.js apps/operations-service/test/s8-53-backdate-permission.test.js
```

Database-backed command:

```powershell
node --test apps/core-service/test/s8-53-office-backdate-db.test.js apps/operations-service/test/backdated.test.js
```

Additional regression run: **87 passed, 0 failed**, covering existing Core office registry/boundaries, Operations Start/Complete, staff backdate/hold switches, Core client behavior, and both new Core database checks. The added migration check runs the actual up migration against a temporary office table on one test connection and confirms both an existing row and a later inserted row default off. The earlier 16-test database run and this regression batch overlap on the Core HTTP case; these are execution totals, not a unique-test count.

```powershell
node --test --test-concurrency=2 apps/core-service/test/s8-53-office-backdate-db.test.js apps/core-service/test/offices.test.js apps/operations-service/test/start.test.js apps/operations-service/test/complete.test.js apps/operations-service/test/cc056-switches.test.js apps/operations-service/test/core-client.test.js
```

The agent ran the database commands with Node's `--test-force-exit` option for bounded test process teardown; all tests completed, with zero failures/cancellations. Syntax verification of the final migration database test passed. Intentional error-path fixtures logged audit/compliance failures while the corresponding rollback/recovery assertions passed.

## Rollout and scope

New Core migration: `S853OfficeBackdatePermission1795478500000`. Its up migration is additive and defaults all offices off. Down migration protects office data using the existing repository data-loss guard. TypeORM synchronization used by local tests derives the field from the entity; production uses the registered migration.

Apply the **Core** migration before deploying Core, then deploy Operations after Core exposes the setting. Decide which offices Super Admin should enable using the audited PATCH endpoint. Older Core responses omit the field, so new Operations denies non-admin backdating until permission can be explicitly granted. Existing historical records are unchanged.

No production migration, push, deployment, or office permission change was performed during implementation. Frontend visibility/settings work (AC3) is excluded, so the whole S8-53 item is not marked Done by this backend delivery.
