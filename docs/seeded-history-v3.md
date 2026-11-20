# Seeded history v3 (Sprint 6 TT1, demo only)

Plan: `CCCMS_SEED_PLAN_V3_11122026.md` (changes `CCCMS_SEED_PLAN_V2_11082026.md`); spec 2.5; decisions K11, K15–K17 and
K32–K34. This file replaces `docs/seeded-history-v2.md`. The script writes **fictional past service records** into the
**demo** Operations database only. It never runs against production and is never scheduled.

Script: `apps/operations-service/scripts/seed-transactions.js` (`npm run seed:transactions -- …` in that folder).
Planner and writer: `apps/operations-service/src/modules/seed/`. Algorithm version: `tt1-seed-v3.1` (printed and stored).

## What changed from v2

| | v2 | v3 |
|---|---|---|
| Period | 07/01–11/06/2026 | **01/05–11/06/2026** |
| Completed | 700 | **1,000** (first half-year 300, second half 700 as before) |
| Open "today" | 40–60 | **about 8** (K32): one per free staff account, one account per office kept free for the presenters |
| Started / Completed by | any active account of the office, at random | **the person who handles the service** (K34), from `ASSIGNMENTS` in `config.js` |
| Dental services (`PUP-ADMIN-DEN-*`) | used | **no rows** (no dentist account), `EXCLUDED_SERVICE_PREFIXES` in `config.js` |
| Late bounds | 110–125 | **150–180** (15–18 % of 1,000; 700 keeps 110–125) |
| New option | | `--presenters=<account id>,…` |

## What it does

| | |
|---|---|
| Completed | 1,000 by default, 01/05–11/06/2026: January 45, Feb 40, Mar 45, Apr 55, May 60, Jun 55 (first half-year 300); July 100, Aug 170, Sep 130, Oct 250, Nov 1–6 50 (second half 700). Offices REG 220, OSAS 200, ADMREG 180, ACAD 140, ADMIN 140, ACCT 50, LIB 40, OSFA 30 (exact). |
| Open "today" | `IN_PROGRESS`, started in the 5 working days (the office's own calendar) before `--as-of`, spread over Low/Medium/High share-of-limit. Target 8 (`DEFAULTS.openTarget`), never more than the free accounts. One per staff account (the one-open rule), never an account that already has a live open transaction, and **never a presenter account**: by default every Office Head stays free; `--presenters=<ids>` keeps exactly those accounts free instead. The run stops if fewer than `OPEN_MIN` (6) can be placed. |
| Who handled it | The person named for the service in `ASSIGNMENTS` starts and completes the row (nurse: medical and clearance services; guidance counselor: counseling and recommendation letters; records in-charge: registrar services; and so on; the full list is in `config.js` and in plan v3 section 4). Names are compared without case, spaces or punctuation. When a listed person is not registered or not active, their services fall back to any active account of the office; the dry run reports it (`assignment.missing_assignees_by_office`, `assignment.fallback_rows`, counts only). Every service family of an assigned person keeps one service in use, so nobody ends up with no rows. |
| Services | Active `PUP-*` services of each office with a standard in force for the whole period (the seeded catalogue standards start 01/01/2025), minus the dental services; a fixed random order per office: top fifth ≈ 60 %, about a third unused; the 7 pattern services are always used. Allowed client types (CC047) are respected. |
| Clients | 70/15/8/7 Student/Alumni/Employee/External; Student/Alumni linked to valid CC043 demo-registry records; ≈3 % NOT_FOUND/EXPIRED with K5 reason codes. No email, no reference, no names on any row. |
| Results | Every end time comes from Core's engine (`add-working-minutes`), every result from Operations' `computeCompliance()` against Core's effective calendar (CC048 office hours, campus fallback, breaks, weekends, holidays, suspensions). Targets checked on the **computed** outcome: 150–180 late and 15–18 % of completed; open rows are outside the denominator. |
| Patterns | As v2 (patterns 1–8 and the last four weeks ≈ 230 rows); pattern 5 (ACAD late rate falling ≈25 %→8 %) now runs over the whole period; pattern 8 (season shape) now also covers the first half-year. |
| Tracking | `PUP-<OFFICE>-YYYYMMDD-9001…9999` per office per Manila date. `tracking_sequences` is never read or written. |
| Provenance | `seed_runs` (every write run) and `seeded_transactions` (every created row). Only rows listed there are ever removed. An unowned row in 9001–9999 stops every write run. |
| Side effects | No Start/Complete endpoint, no email (no `transaction_emails`, receipt `NONE`), no calendar writes, no FMS/SCMS, no per-row audit. One TT2 analytics event per row through `analytics_outbox` (the supported path). Exactly one audit entry per successful write run: entity "Historical records import", action `HISTORICAL_RECORDS_IMPORTED` or `HISTORICAL_RECORDS_REMOVED`, with run id, operator, period, as-of, seed, algorithm, input digest, counts and backup references. |

Reproducibility: the same `--seed`, `--from/--to/--volume`, `--as-of`, `--presenters`, and unchanged catalogue, accounts,
registry, calendar and live open transactions give the same **plan digest** (business data only: tracking number, office,
service, standard, client type, registry fields, start/end, staff, status and result; never ids, audit timestamps or
delivery metadata). Every run prints the **inputs digest** and the plan digest; `--verify` recomputes the digest from the
stored rows. Transaction ids are derived from the run id, so a replaced row never collides with a tombstoned one in Oversight.

## Gates (all fail closed)

* `SEED_TARGET=demo` for every mode, including `--dry-run`.
* Writes (import, `--remove`): `DATABASE_URL` host/database in `SEED_DEMO_DATABASES` (comma list of `host/database`),
  `--confirm=<database name>`, the Oversight URL (`OVERSIGHT_SERVICE_URL` or `LOGS_SERVICE_URL`) host in
  `SEED_DEMO_OVERSIGHT_HOSTS`, operator-verified backups `SEED_BACKUP_OPERATIONS_REF`, `SEED_BACKUP_OVERSIGHT_REF` and
  `SEED_BACKUP_VERIFIED_AT` (ISO, within 24 h), and `--operator=<account id>` that Identity confirms is an active Super Admin.
* The demo Oversight deployment needs `ANALYTICS_SEED_PURGE=enabled` (only there) for removal/replacement.
* Other variables used: `SERVICE_KEY`, `CORE_URL`, `IDENTITY_URL` (read-only service-key calls).

## Order on the hosted demo (Codex / BE Dev 1)

1. Deploy and migrate: Core `Cc047AllowedClientTypes`, Identity (new internal routes, no migration), Operations
   `Cc044RegistryAtStart`, `Cc049TransactionEmails`, `Tt1SeedProvenance`, Oversight `Tt1AnalyticsTombstones`.
2. The PM's accounts exist: the 16 office accounts of 11/12/2026 (8 heads, 8 staff). Do not rename or deactivate them
   before the run: the assignment list matches the registered full names (`ASSIGNMENTS` in `config.js`).
3. The institution code is set on the hosted system (`PUP`), so office codes and tracking numbers resolve.
4. CC043 demo registry import (`Registry Mock Data (11082026)`).
5. Dry run, check the printed aggregates against plan v3 section 2, and that `assignment.fallback_rows` is 0:
   `SEED_TARGET=demo node --env-file=<demo-ops-env> scripts/seed-transactions.js --dry-run --as-of=<YYYY-MM-DD>`
   (add `--presenters=<id>,<id>…` if the presenters will use accounts other than the Office Heads).
6. Backups of the Operations and Oversight demo databases; record their references and the verification time.
7. Import: `SEED_TARGET=demo node --env-file=<demo-ops-env> scripts/seed-transactions.js --as-of=<same> --operator=<super-admin id> --confirm=<ops db>`
   (with the same `--presenters` as the dry run, if used).
8. TT2 backfill (explicit step): in `apps/oversight-service`, `DB_TARGET=hosted node --env-file=<demo-oversight-env> scripts/analytics-backfill.js --confirm=<oversight db>`.
9. CC052 initial training: **blocked until CC052 ships** (the CC038 forecast retrain is not late-risk training).
10. Look at Insights; publish the first half-year report (01/05–06/30) and keep the current half-year as the draft (L-02).

Removal / recovery: `… scripts/seed-transactions.js --remove --operator=<id> --confirm=<ops db>`. It removes every owned
row (and its outbox events), records the removal, then purges the Oversight projection through
`POST /api/internal/analytics-purge` (seeded rows only, tombstoned so no replay or backfill restores them). Exit code 2 =
Operations committed but the Oversight purge did not finish; fix Oversight and run `--remove` again (it retries the pending
purge; a repeated remove is safe). Exit code 1 = nothing was written. Restoring a backup is the last resort.

Keep other writers quiet during an import/removal: do not run the analytics backfill at the same time. The tombstones
make a concurrent dispatch or backfill harmless, but the counts printed by the run are only exact in a quiet window.

## Read-only pattern checks (until CC054 exists)

Run against the **Oversight** demo database after the backfill (`analytics_transactions`, `is_seeded = true`).

```sql
-- Overall: 150-180 late, 15-18 % of completed seeded rows (open rows excluded).
SELECT count(*) FILTER (WHERE is_compliant = false) AS late, count(*) AS completed,
       round(100.0 * count(*) FILTER (WHERE is_compliant = false) / count(*), 1) AS late_pct
  FROM analytics_transactions WHERE is_seeded AND status = 'COMPLETED' AND is_compliant IS NOT NULL;

-- Month and office shape (by Manila start date): January to November 06.
SELECT to_char(started_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS month, split_part(tracking_no, '-', 2) AS office, count(*)
  FROM analytics_transactions WHERE is_seeded AND status = 'COMPLETED' GROUP BY 1, 2 ORDER BY 1, 2;

-- Half-year split: 300 in 01/05-06/30 and 700 in 07/01-11/06.
SELECT CASE WHEN (started_at AT TIME ZONE 'Asia/Manila')::date <= '2026-06-30' THEN 'first half' ELSE 'second half so far' END AS half,
       count(*)
  FROM analytics_transactions WHERE is_seeded AND status = 'COMPLETED' GROUP BY 1;

-- Charter check per service: late rate (flag > 20 %) and P90 share of the limit (flag < 25 %); >= 20 completed.
SELECT service_code, count(*) AS completed,
       round(100.0 * count(*) FILTER (WHERE NOT is_compliant) / count(*), 1) AS late_pct,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY elapsed_working_minutes) AS p90_elapsed
  FROM analytics_transactions WHERE is_seeded AND status = 'COMPLETED' AND is_compliant IS NOT NULL
 GROUP BY service_code HAVING count(*) >= 20 ORDER BY late_pct DESC;

-- Credential rush (pattern 1): REG-CRD-005/002 in 10/12-10/23.
SELECT service_code, count(*), round(100.0 * count(*) FILTER (WHERE NOT is_compliant) / count(*), 1) AS late_pct
  FROM analytics_transactions
 WHERE is_seeded AND service_code IN ('PUP-REG-CRD-005', 'PUP-REG-CRD-002')
   AND (started_at AT TIME ZONE 'Asia/Manila')::date BETWEEN '2026-10-12' AND '2026-10-23'
 GROUP BY service_code;

-- General Assembly (pattern 2): monthly counts of OSAS-ACT-001 and ADMIN-FAC-001/002.
SELECT service_code, to_char(started_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS month, count(*)
  FROM analytics_transactions
 WHERE is_seeded AND service_code IN ('PUP-OSAS-ACT-001', 'PUP-ADMIN-FAC-001', 'PUP-ADMIN-FAC-002')
 GROUP BY 1, 2 ORDER BY 1, 2;

-- Improving office (pattern 5): ACAD weekly late rate.
SELECT date_trunc('week', started_at AT TIME ZONE 'Asia/Manila')::date AS week, count(*),
       round(100.0 * count(*) FILTER (WHERE NOT is_compliant) / count(*), 1) AS late_pct
  FROM analytics_transactions WHERE is_seeded AND status = 'COMPLETED' AND tracking_no LIKE 'PUP-ACAD-%'
 GROUP BY 1 ORDER BY 1;

-- Unusual cases (pattern 6): above Q3 + 3 x IQR of their service (services with >= 20 completed).
WITH s AS (
  SELECT service_id, percentile_cont(0.25) WITHIN GROUP (ORDER BY elapsed_working_minutes) AS q1,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY elapsed_working_minutes) AS q3
    FROM analytics_transactions WHERE is_seeded AND status = 'COMPLETED' AND elapsed_working_minutes IS NOT NULL
   GROUP BY service_id HAVING count(*) >= 20)
SELECT a.tracking_no, a.service_code, a.elapsed_working_minutes, s.q3
  FROM analytics_transactions a JOIN s USING (service_id)
 WHERE a.is_seeded AND a.elapsed_working_minutes > s.q3 + 3 * (s.q3 - s.q1);

-- Open rows (about 8) and registry flags.
SELECT status, count(*) FROM analytics_transactions WHERE is_seeded AND status IN ('IN_PROGRESS', 'ON_HOLD') GROUP BY 1;
SELECT registry_status, registry_miss_reason, count(*) FROM analytics_transactions WHERE is_seeded GROUP BY 1, 2 ORDER BY 1, 2;
```

On the **Operations** demo database (the assignment by position, K34):

```sql
-- No dental service has a seeded row.
SELECT count(*) FROM transactions t JOIN seeded_transactions s USING (transaction_id)
 WHERE s.removed_at IS NULL AND t.service_code LIKE 'PUP-ADMIN-DEN-%';            -- 0

-- Each seeded row of a medical or clearance service was started and completed by the campus nurse only.
SELECT t.started_by_position, count(*) FROM transactions t JOIN seeded_transactions s USING (transaction_id)
 WHERE s.removed_at IS NULL AND (t.service_code LIKE 'PUP-ADMIN-MED-%' OR t.service_code LIKE 'PUP-ADMIN-CLR-%')
 GROUP BY 1;                                                                       -- one row: Campus Nurse

-- Nobody holds more than one open seeded row, and no Office Head holds one (unless --presenters was used).
SELECT started_by, count(*) FROM transactions t JOIN seeded_transactions s USING (transaction_id)
 WHERE s.removed_at IS NULL AND t.status = 'IN_PROGRESS' GROUP BY 1 HAVING count(*) > 1;   -- no rows
```

`SELECT count(*) FROM tracking_sequences` is unchanged by a run;
`SELECT count(*) FROM transaction_emails t JOIN seeded_transactions s USING (transaction_id)` is 0.
