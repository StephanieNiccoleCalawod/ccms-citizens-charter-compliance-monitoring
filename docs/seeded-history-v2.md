# Seeded history v2 (Sprint 6 TT1, demo only)

Plan: `CCCMS_SEED_PLAN_V2_11082026.md`; spec 2.5; decisions K11, K15–K17. The script writes **fictional past service
records** into the **demo** Operations database only. It never runs against production and is never scheduled.

Script: `apps/operations-service/scripts/seed-transactions.js` (`npm run seed:transactions -- …` in that folder).
Planner and writer: `apps/operations-service/src/modules/seed/`. Algorithm version: `tt1-seed-v2.1` (printed and stored).

## What it does

| | |
|---|---|
| Completed | 700 by default, 07/01–11/06/2026 (July 100, Aug 170, Sep 130, Oct 250, Nov 1–6 50); offices REG 154, OSAS 140, ADMREG 126, ACAD 98, ADMIN 98, ACCT 35, LIB 28, OSFA 21 (exact). |
| Open "today" | 40–60 (target 50) `IN_PROGRESS`, started in the 5 working days (the office's own calendar) before `--as-of`, spread over Low/Medium/High share-of-limit. One per staff account (the one-open rule), never a staff account that already has a live open transaction. |
| Services | Active `PUP-*` services of each office with a standard in force for the whole period; a fixed random order per office: top fifth ≈ 60 %, about a third unused; the 7 pattern services are always used. Allowed client types (CC047) are respected. |
| Clients | 70/15/8/7 Student/Alumni/Employee/External; Student/Alumni linked to valid CC043 demo-registry records; ≈3 % NOT_FOUND/EXPIRED with K5 reason codes. No email, no reference, no names on any row. |
| Results | Every end time comes from Core's engine (`add-working-minutes`), every result from Operations' `computeCompliance()` against Core's effective calendar (CC048 office hours, campus fallback, breaks, weekends, holidays, suspensions). Targets checked on the **computed** outcome: 110–125 late and 15–18 % of completed; open rows are outside the denominator. |
| Patterns | 1 credential rush (REG-CRD-005/002, ~30 % late in 10/12–10/23); 2 OSAS-ACT-001 ×3 in October, ADMIN-FAC-001/002 ×2 in October, normal in November; 3 OSAS-CRD-007 ≈ ¼ of its limit; 4 ADMREG-ACC-003 ≈ 30 % late; 5 ACAD late rate falling ≈25 %→8 %; 6 four unusual cases at 3.5–6× the usual share; 7 calendar (only working time is used); 8 July low, late-August Admission/Registrar peak, October peak; ≈230 rows in the last four weeks. |
| Tracking | `PUP-<OFFICE>-YYYYMMDD-9001…9999` per office per Manila date. `tracking_sequences` is never read or written. |
| Provenance | `seed_runs` (every write run) and `seeded_transactions` (every created row). Only rows listed there are ever removed. An unowned row in 9001–9999 stops every write run. |
| Side effects | No Start/Complete endpoint, no email (no `transaction_emails`, receipt `NONE`), no calendar writes, no FMS/SCMS, no per-row audit. One TT2 analytics event per row through `analytics_outbox` (the supported path). Exactly one audit entry per successful write run: entity "Historical records import", action `HISTORICAL_RECORDS_IMPORTED` or `HISTORICAL_RECORDS_REMOVED`, with run id, operator, period, as-of, seed, algorithm, input digest, counts and backup references. |

Reproducibility: the same `--seed`, `--from/--to/--volume`, `--as-of`, and unchanged catalogue, accounts, registry,
calendar and live open transactions give the same **plan digest** (business data only: tracking number, office, service,
standard, client type, registry fields, start/end, staff, status and result; never ids, audit timestamps or delivery
metadata). Every run prints the **inputs digest** and the plan digest; `--verify` recomputes the digest from the stored rows.
Transaction ids are derived from the run id, so a replaced row never collides with a tombstoned one in Oversight.

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
2. The PM's accounts exist (≥ 40 active Office Head/Staff accounts without an open transaction across the eight offices).
3. CC043 demo registry import (`Registry Mock Data (11082026)`).
4. Dry run, check the printed aggregates against plan section 1:
   `SEED_TARGET=demo node --env-file=<demo-ops-env> scripts/seed-transactions.js --dry-run --as-of=<YYYY-MM-DD>`
5. Backups of the Operations and Oversight demo databases; record their references and the verification time.
6. Import: `SEED_TARGET=demo node --env-file=<demo-ops-env> scripts/seed-transactions.js --as-of=<same> --operator=<super-admin id> --confirm=<ops db>`
7. TT2 backfill (explicit step): in `apps/oversight-service`, `DB_TARGET=hosted node --env-file=<demo-oversight-env> scripts/analytics-backfill.js --confirm=<oversight db>`.
8. CC052 initial training — **blocked: no CC052 training entry point exists on base 27cb00b** (the CC038 forecast retrain is not
   late-risk training). Run it only once CC052 ships.
9. Look at Insights.

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
-- Overall: 110-125 late, 15-18 % of completed seeded rows (open rows excluded).
SELECT count(*) FILTER (WHERE is_compliant = false) AS late, count(*) AS completed,
       round(100.0 * count(*) FILTER (WHERE is_compliant = false) / count(*), 1) AS late_pct
  FROM analytics_transactions WHERE is_seeded AND status = 'COMPLETED' AND is_compliant IS NOT NULL;

-- Month and office shape (by Manila start date).
SELECT to_char(started_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS month, split_part(tracking_no, '-', 2) AS office, count(*)
  FROM analytics_transactions WHERE is_seeded AND status = 'COMPLETED' GROUP BY 1, 2 ORDER BY 1, 2;

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

-- Open rows and registry flags.
SELECT status, count(*) FROM analytics_transactions WHERE is_seeded AND status IN ('IN_PROGRESS', 'ON_HOLD') GROUP BY 1;
SELECT registry_status, registry_miss_reason, count(*) FROM analytics_transactions WHERE is_seeded GROUP BY 1, 2 ORDER BY 1, 2;
```

On the **Operations** demo database: `SELECT count(*) FROM tracking_sequences` is unchanged by a run;
`SELECT count(*) FROM transaction_emails t JOIN seeded_transactions s USING (transaction_id)` is 0.
