# S8-08 seeded history verification

Reviewed November 20, 2026 (Manila). The release checkout at `f0b936e` had v2.1 defaults. The local changes restore the archived v3.1 operator configuration, planner, CLI and tests. The hosted ledger already records v3.1.

## Dry run

The release planner ran locally with the repository's office, account, calendar and registry fixtures and an as-of date of November 12, 2026. Counts below use the Manila start month. Open rows are separate from monthly completed counts.

| Month | REG | OSAS | ADMREG | ACAD | ADMIN | ACCT | LIB | OSFA | Completed |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Jan | 10 | 9 | 8 | 6 | 7 | 2 | 2 | 1 | 45 |
| Feb | 8 | 8 | 7 | 6 | 6 | 2 | 2 | 1 | 40 |
| Mar | 10 | 10 | 8 | 6 | 6 | 2 | 2 | 1 | 45 |
| Apr | 11 | 11 | 10 | 8 | 8 | 3 | 2 | 2 | 55 |
| May | 13 | 12 | 10 | 9 | 8 | 3 | 3 | 2 | 60 |
| Jun | 11 | 11 | 10 | 8 | 8 | 3 | 2 | 2 | 55 |
| Jul | 21 | 20 | 18 | 15 | 14 | 5 | 4 | 3 | 100 |
| Aug | 42 | 30 | 36 | 22 | 21 | 8 | 6 | 5 | 170 |
| Sep | 28 | 26 | 23 | 19 | 18 | 7 | 5 | 4 | 130 |
| Oct | 56 | 53 | 41 | 34 | 37 | 12 | 10 | 7 | 250 |
| Nov | 10 | 10 | 9 | 7 | 7 | 3 | 2 | 2 | 50 |
| **Completed** | **220** | **200** | **180** | **140** | **140** | **50** | **40** | **30** | **1,000** |
| Open | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 0 | 8 open |
| Office heads required | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 8 heads |
| Office staff required | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 0 | 8 staff |

The plan produced zero duplicate tracking numbers, zero missing assignees, zero fallback assignments and zero dental rows. The CLI also requires an active Super Admin for writes. The office roster and service assignments are in the v3 configuration.

On November 20 the hosted Identity database had 8 active office heads, 7 active office staff and 3 active Super Admins. LIB had one active staff account against two in the dry-run roster. The other seven offices matched the expected role counts. A new hosted run would need a fresh dry run against the current roster.

## Hosted ledger and provenance

Read-only queries against the default branch of `ccms-operations`, database `ccms_operations`, found one import, run `b38494d5-37e1-4bda-8a04-50290563bc2c`. It committed November 12 at 11:51 p.m. Manila time with algorithm `tt1-seed-v3.1`, 1,000 completed, 8 open and 162 late. The plan digest is `cad9b907bd158b3a9b0118c39a82fdc5a28483027b213d6272b883282436ba14`. Its audit entry records Operations snapshot `snap-spring-hall-b3crciv5` and Oversight snapshot `snap-mute-mountain-b3t78bor`.

All 1,008 active provenance entries joined to current transactions and the seed run. There were zero duplicate tracking numbers, zero unowned transactions in the reserved range and zero seeded dental rows. The live status split was 1,001 completed and 7 open. Replacing the seed would discard subsequent edits to those rows.

```sql
SELECT r.run_id, r.algorithm_version, r.created_at, r.counts
FROM seed_runs r ORDER BY r.created_at;

SELECT count(*) AS active_entries, count(t.transaction_id) AS live_rows,
       count(r.run_id) AS linked_to_run, count(DISTINCT t.tracking_no) AS unique_tracking,
       count(*) FILTER (WHERE t.service_code LIKE 'PUP-ADMIN-DEN-%') AS dental
FROM seeded_transactions s
LEFT JOIN transactions t USING (transaction_id)
LEFT JOIN seed_runs r USING (run_id)
WHERE s.removed_at IS NULL;
```

PM approval of the dry run and designation of this database as the accepted demo target still require supporting records. No new hosted import was performed during verification.
