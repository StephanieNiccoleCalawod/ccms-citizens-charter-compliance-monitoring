# Row 36 / S8-58 - production fee backfill

Date: 28 November 2026 (Asia/Manila). Scope: BE Dev 1, approved D-AC-7 classifications.

## Production result

Applied `S858CharterFeeBackfill1795852800000` to `ccms_core` in Neon project `sweet-hat-38646949`, production branch `br-shy-flower-a1q7bn9t`.

| Check | Before | After |
| --- | ---: | ---: |
| Total services | 78 | 78 |
| Active services | 77 | 77 |
| Active fee-paying | 77 | 20 |
| Active no-fee | 0 | 57 |
| Remaining eligible backfill changes | 57 | 0 |

The 57 corrections comprise 56 active blank/bare `None` fee entries and the explicitly approved Transcript first-copy exception. No Charter fee text or service names were changed. A comparison of all 78 service IDs, codes, names, fee text, flags and active states found exactly 57 flag differences and no other differences in those fields.

| Approved exception | Service code | Final flag |
| --- | --- | --- |
| Transcript first copy | PUP-REG-CRD-005 | false |
| General Clearance | PUP-ACCT-CLR-001 | true |
| Transferee accreditation | PUP-ADMREG-ACC-003 | true |
| Freshman admission | PUP-ADMREG-ADM-001 | true |
| Inactive test service | PUP-ACAD-AOTSO-001 | unchanged: true, inactive |

Core `audit_outbox` and Oversight `audit_log` were checked using the actual lowercase `super_admin` role. Neither contained an explicit administrator correction from a different flag to `has_fee=true` before this backfill. The migration preserves such overrides if present in Core's audit history.

## Backup and execution

Both the initial snapshot request and a backup-branch request failed because of Neon limits. A native PostgreSQL dump attempt was blocked by this session's network restrictions and produced no usable backup.

The user then explicitly approved replacing only snapshot `snap-dawn-frog-a1yy68ie` (`tt6-freeze-20261120-ccms-core`). That snapshot was deleted and replaced with:

- Snapshot: `snap-lively-hall-a1s2as4v`
- Name: `s858-fee-backfill-20261128`
- Source: `br-shy-flower-a1q7bn9t`
- Created: 28 November 2026, 6:03:14 PM Asia/Manila (`2026-11-28T10:03:14Z`)
- Confirmed full size: 42,754,048 bytes

The exact SQL exported by the new migration passed PostgreSQL `EXPLAIN` without `ANALYZE`. Its read-only candidate preview returned 57 changes to false and zero changes to true.

The migration SQL and TypeORM ledger insertion were applied through the connected Neon transaction tool in one transaction, with the shared migration advisory lock, a service-table write lock, a ten-second lock timeout, and count guards. The transaction returned 57 changed services and 57 audit events. The ledger contains the new migration once.

Every correction has a `SERVICE_UPDATED` outbox event, with before/after flags, a system actor and the reason `D-AC-7 Charter fee backfill approved by PM`. Post-commit queries confirmed 57 events for 57 distinct services, all true-to-false. Central audit delivery was not claimed or forced.

## Code and verification

- Added an append-only, idempotent migration. Its down step preserves corrected flags and subsequent administrator changes.
- New/imported services without an explicit flag derive it from the fee entry and approved exceptions. Explicit flags and ordinary edits remain preserved.
- Updated the migration rollback-order test and the as-of service fixture for the new no-fee default.
- Core lint passed. Targeted diff whitespace check passed.
- Fifteen tests passed across fee parsing, receipt-upload fee guards, runtime database protection, migration guards and schema fingerprint handling.
- Added database tests for classification, audit atomicity, repeat runs, inactive rows, explicit overrides and rollback. They could not execute here: the loopback PostgreSQL server at port 55432 was unavailable (`ECONNREFUSED`). No successful local database rehearsal or full migration-suite pass is claimed.
- Existing receipt metadata/image read paths were not changed. No production receipt images were opened. Hosted UI evidence and a live legacy-receipt opening are outside this backfill verification.

The production data correction is complete. This record accompanies the S8-58 source changes; deployment of those changes is a separate step from the already-applied production backfill.
