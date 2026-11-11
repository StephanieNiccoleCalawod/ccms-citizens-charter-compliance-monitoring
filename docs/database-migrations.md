# Database migrations (TT1) and the hosted runbook

Every change to a hosted database (Identity, Core, Operations, Oversight) is a numbered, reviewed TypeORM migration.
Schema synchronization (`db:sync`) is for disposable local databases only and is refused for a hosted target.

Reviewed against the supplied `CCCMS_SPRINT5-8_TECHNICAL_SPECIFICATIONS_11082026.md` section 2.1. The baseline below
was reconstructed from old code and verified against isolated copies of all four hosted databases on November 10,
2026. Retained backups and separate rehearsal branches are recorded in the release evidence. Production execution
remains a separate release step. The seed plan is a reference requirement, not authorization to import mock data.

## 1. How it works

| Piece | Where |
| --- | --- |
| Migration classes, in order | `apps/<service>/migrations/<13-digit ms>-<Name>.js`, listed in `migrations/index.js` |
| Frozen baseline DDL | `apps/<service>/migrations/sql/1793491200000-<Service>Baseline.up.sql` |
| Baseline fingerprint | `apps/<service>/migrations/baseline-schema.json` (what `migrate:baseline` compares against) |
| Command line | `apps/<service>/scripts/migrate.js` using `runMigrationCli` from `packages/ccms-shared/src/migrations.js` |
| Bookkeeping table | `typeorm_migrations` (TypeORM's standard `id`, `timestamp`, `name` columns) in each database |
| Acceptance tests | `scripts/migrations.test.mjs` (`npm run test:safety`; disposable PostgreSQL from `TEST_PG_URL`) |

**Naming.** `<13-digit epoch milliseconds>-<PascalCaseName>.js` exporting `class <PascalCaseName><timestamp>`, with
`name = '<PascalCaseName><timestamp>'`. TypeORM orders by the timestamp. Name Sprint work after its backlog item
(`Cc050TransactionOutcome`). Migrations are **append only**: never edit, rename or reorder one that may have run on the
hosted database; write a new migration instead. Each migration runs in its own transaction (`transaction: 'each'`).

### Commands (from a service directory, or `--workspace=apps/<service>`)

| Command | Writes? | What it does |
| --- | --- | --- |
| `npm run migrate:show` | no | Lists every migration as `[X]` applied or `[ ]` pending; flags rows recorded in the database but unknown to the code. Does not create the bookkeeping table. |
| `npm run migrate:check-baseline` | no | Compares the live schema with `baseline-schema.json`. Exit 1 when objects are missing or different. |
| `npm run migrate:baseline` | bookkeeping only | **Existing database**: verifies the schema matches the baseline, then creates `typeorm_migrations` and records the baseline as applied. Never runs the baseline's DDL and never touches a business table or row. |
| `npm run migrate:run` | yes | Applies pending migrations in order. On an **empty** database this runs the baseline and creates the whole schema. On a database that has tables but no recorded migrations it refuses (adopt the baseline first). |
| `npm run migrate:revert` | yes | Reverts the most recent applied migration (one per call). |
| `npm run migrate` | yes | Same as `migrate:run` (it used to be schema synchronization). |

Root shortcuts: `npm run db:migrate` (run, all four services), `npm run db:migrate:show`,
`npm run db:migrate:check-baseline`. There is deliberately no all-services revert.

The migration commands connect with `DATABASE_ADMIN_URL` when it is set, otherwise `DATABASE_URL`. For Oversight this
must be the schema owner, never `ccms_logs_writer`.

Use a **direct, unpooled** admin connection for migrations. Neon `-pooler` endpoints are refused for write commands:
transaction pooling cannot preserve the session advisory lock. Runtime services may continue using their pooled URLs.
Set the direct endpoint in `DATABASE_ADMIN_URL` through secure environment configuration, never in the repository.

### Target guard

`DB_TARGET` marks the database: `local` or `hosted` (the team's hosted marker). When unset, a loopback host is local and
anything else is hosted (fail closed). A known hosted provider host (`*.neon.tech` and similar) is always hosted, and
`DB_TARGET=local` with such a host is rejected.

* `db:sync`, Core `db:bootstrap`, and any `synchronize: true` data source are refused with `NODE_ENV=production`, even
  for a local target. They are also refused for a hosted target **before a
  connection is opened** (`assertSchemaSyncAllowed`, and the same check inside `createDataSource`).
* The running services always use `synchronize: false`. `DB_SYNCHRONIZE=true` on a hosted target is ignored with a
  warning; keep `DB_SYNCHRONIZE=false` in every hosted environment.
* `migrate:run`, `migrate:revert` and `migrate:baseline` on a hosted target additionally require `DB_TARGET=hosted` to be
  set explicitly **and** `--confirm=<database name>` matching the connected database.
* Identity `bootstrap:admin` only synchronizes a local database; on a hosted one it inserts the first Super Admin only.
* Nothing runs migrations or synchronization on `dev`, `start`, `build` or install.
* The interim explicit scripts (`migrate:sprint4`, `migrate:sprint5`) remain as the approved fallback. They never
  synchronize; once a database is tracked by the migrations they are not needed.

### Supported starting schema

The baseline (`1793491200000-*Baseline`) is the schema produced by `db:sync` at commit `64ca621`, the last commit before
the Sprint 5 schema changes. It includes everything from Sprints 1-4, including the Sprint 4 critical migrations
(`sprint4-critical.js`) and Oversight's roles and grants. It was captured with `pg_dump --schema-only` from a disposable
database built by that code; nine CHECK / partial-index expressions use the original source text because PostgreSQL
stores pg_dump's deparsed form differently when re-executed (see the header of each SQL file).

Supported candidate starting points, exercised on reconstructed disposable databases by `scripts/migrations.test.mjs`.
These fixtures are not evidence that the actual hosted schema matches:

| Hosted state | `check-baseline` | Adoption | Then `migrate:run` |
| --- | --- | --- | --- |
| A. Exactly the Sprint 4 schema | matches exactly | `migrate:baseline` | adds the Sprint 5 columns (Identity CC046, Operations CC050, CC046) |
| B. Sprint 4 + the interim `migrate:sprint5` already run | lists the Sprint 5 columns/check as `unexpected` | `migrate:baseline -- --accept-extra` | records the Sprint 5 migrations; **no schema or data change** (`IF NOT EXISTS`, same definitions) |
| C. Anything else (missing or different objects) | exit 1, lists `missing` / `changed` | **refused** | do not proceed: report the differences for a reviewed fix-up migration |

`--accept-extra` permits only the exact object names and definitions in each service's `migrations/sprint5-schema.json`:
Identity position column/check (the two reviewed check versions); Core office schedules; Operations outcome columns,
starter labels, outside-hours flag and forecast storage. Oversight allows no extras. Unknown objects (including
additional indexes), or incompatible types, nullability, defaults and constraints,
block adoption even with this flag. Numbered migrations also validate existing objects before DDL. These PostgreSQL
16 definitions are deliberately strict; review version-dependent differences instead of bypassing the comparison.

PostgreSQL 18 additionally records table NOT NULL constraints in `pg_constraint`. The fingerprint represents
validated requirements once, through column nullability, so PostgreSQL 16 and 18 compare consistently. Unvalidated
or inconsistent NOT NULL constraints remain separate, blocking differences; nullability changes are still detected.

Oversight has no post-baseline schema change on this branch. The other services apply the numbered additions below.

### Numbered migrations on this branch

| Service | Migration | Change | Revert |
| --- | --- | --- | --- |
| all | `<Service>Baseline1793491200000` | Whole pre-Sprint-5 schema (empty databases only) | **Refused**: restore the backup instead |
| Operations | `Cc050TransactionOutcome1794182400000` | `transactions.outcome`, `disapproval_reason`, `disapproval_notice_given`, `transactions_outcome_ck` | Drops the check and the three columns |
| Identity | `Cc046AccountPosition1794225600000` | `accounts.position`, `accounts_position_ck` | Drops the check and the column |
| Operations | `Cc046StartedByPosition1794225600000` | `transactions.started_by_position` | Drops the column |
| Core | `Cc048OfficeSchedules1794300000000` | Office schedules and persistent version counters | Drops both empty tables; populated tables require explicit data-loss authorization |
| Operations | `Cc046StarterName1794300100000` | `transactions.started_by_name` | Drops the column after the value guard |
| Operations | `Cc051OutsideHours1794300200000` | `transactions.started_outside_hours`, default false | Drops the column after the value guard |
| Operations | `Cc038ForecastRuns1794300300000` | Forecast storage, indexes and checks | Drops the empty table; populated storage requires explicit data-loss authorization |
| Identity | `Cc046TrimmedPosition1794300400000` | Stronger trimmed-position check | Restores the previous check; changes no account values |
| Operations | `Tt2AnalyticsOutbox1794355200000` | Sprint 5 TT2: `transactions.analytics_event_version` (default 0) and `analytics_outbox` | Refused while the outbox has rows or any version is not 0, unless explicitly allowed |
| Oversight | `Tt2AnalyticsTransactions1794355300000` | Sprint 5 TT2: `analytics_transactions`, `analytics_backfill_state`, exact runtime grants | Refused while either table has rows, unless explicitly allowed |

TT2 details, rollout order and backfill: [analytics-feed.md](analytics-feed.md).

The stricter position migration refuses untrimmed existing values instead of silently changing them. Any required
normalization needs a separately reviewed data correction. Existing new tables must match the complete frozen
contract; partial tables, missing checks/indexes, and unreviewed additions are refused. Frozen SQL is checked out with
LF line endings via `.gitattributes` so function-body checksums remain stable on Windows and Linux.

**Reversible is not lossless.** Reverting a migration that added a column deletes every value stored in that column.
Each down migration therefore refuses while any row holds a value in a column it would drop, unless the operator sets
`CCMS_ALLOW_DATA_LOSS=<exact migration name>` (comma-separated for several) after taking a backup. In state B above the
Sprint 5 columns existed before the migration was recorded; reverting it still drops them and their data. The only
lossless rollback of data is restoring the backup.

## 2. FMS cal-1.0 queue drain (before activating FMS_TERM_ID)

This step is required once, on Core's database, before `FMS_TERM_ID` is set in any hosted environment. It converts
stale cal-1.0 FMS rows that were queued before the Schema V3 integration to `SUPERSEDED` so the 401-retry path
cannot re-send them to FMS after the key rotation. Run after any pending rows have been attempted (they are either
`SENT` / `ACKNOWLEDGED`, or `FAILED`).

```sql
-- Run on Core's database. Record the row count it returns as evidence.
UPDATE sync_log
SET status = 'SUPERSEDED'
WHERE consumer_system = 'FMS'
  AND status IN ('PENDING', 'FAILED')
  AND payload->>'schemaVersion' = 'cal-1.0';
```

The filter `payload->>'schemaVersion' = 'cal-1.0'` limits the update to old-format rows only; any schema 3 rows
already queued (there should be none before `FMS_TERM_ID` is set) are untouched. Send the row count to the FMS team
as evidence before they verify the queue is drained.

This is **not** a TypeORM migration. It is a one-time data operation run by BE Dev 1 from a trusted machine with the
direct admin connection, before `FMS_TERM_ID` is added to the hosted environment's configuration.

## 3. Hosted runbook (BE Dev 1 only)

Hosted execution belongs to **BE Dev 1**, after a verified backup. Nobody else runs any write command against a hosted
database. Do the services one at a time, in this order: **Oversight, Identity, Core, Operations** (the same order as
`db:sync`; Operations last because its code depends on Identity's position field).

Run from a trusted machine with the repository at the reviewed commit, from the service directory. Put the connection
strings in the shell environment (or the service's untracked `.env.local`); never paste them into a command line, chat,
ticket or the PR.

### Step 0. Prerequisites

- [ ] The PR is reviewed and the candidate commit recorded. Do not merge into the deployment branch unless automatic
      deployments are explicitly paused and the pause verified, or an approved release/promotion procedure prevents early deployment.
- [ ] Check every Vercel project's Git production branch and deployment triggers; repository CI does not establish
      whether Vercel auto-deploys. Record the deployment hold or release procedure in the PR.
- [ ] The new application code is **not yet deployed** (the Sprint 5 code reads the new columns).
- [ ] A maintenance window is agreed; writes to the service can be paused if needed.
- [ ] `DB_SYNCHRONIZE=false` in every hosted environment (Vercel project settings for all four services).

### Step 1. Backup and verify it (required before the first hosted execution, AC5)

For each database, either:

* **Neon branch (preferred):** in the Neon console create a branch of the production branch named
  `pre-tt1-<service>-<YYYYMMDD>` (point-in-time copy, includes data). Record the branch name and its creation time; or
* **Logical dump:** `pg_dump --format=custom --no-owner --file=<service>-pre-tt1.dump "$DATABASE_ADMIN_URL"`, stored
  only in the team's approved secure location (it contains personal data; **never commit it**).

Verify the backup before continuing:

* Neon branch: connect to the branch and compare row counts of the business tables with production
  (`SELECT count(*) FROM <table>` for each table listed by `\dt`).
* Dump: `pg_restore --list <service>-pre-tt1.dump` succeeds, and a restore into a scratch database shows the same row
  counts.

Record in the PR: backup method, branch name or dump file name (not its location credentials), timestamp, verifier.
**Do not continue without it.**

### Step 2. Verify the database target (no credentials shown)

```sh
export DB_TARGET=hosted
npm run migrate:show
```

The first line prints the database name, host, port and user only, for example
`core: show on database "neondb" at ep-....ap-southeast-1.aws.neon.tech:5432 as neondb_owner (target hosted: ...)`.
Confirm it is the intended project, branch and database. It should say "Migration tracking is not set up" with every
migration `[ ]`. If anything is already recorded, stop and investigate.

### Step 3. Verify the baseline (read-only)

```sh
npm run migrate:check-baseline
```

On an isolated copy of the actual hosted database, configure the connection through the shell environment and run
`node ../../scripts/db-schema-fingerprint.mjs > <service>-hosted-schema.json` (read-only session). Compare this actual
hosted-copy fingerprint with the baseline. Attach a reviewed, redacted schema-only result to the PR. It contains no
rows or connection string, but definitions may contain sensitive literals: inspect before sharing. Keep the backup
in approved secure storage. Do not substitute a database generated from old entities. If a hosted copy or schema
evidence is unavailable, leave AC1 pending and stop before adoption.

* "matches ... exactly" → state A.
* Only `unexpected` lines, and they are exactly the Sprint 5 objects in the table above → state B.
* Any `missing` or `changed` line, or `unexpected` objects that are not the Sprint 5 objects → **stop**. Do not adopt.
  Send the output to the team (see section 4).

### Step 4. Rehearse on the backup branch

Repeat steps 2-6 against the Neon backup branch (or a scratch restore of the dump) first, with `--confirm=<that
database>`. Only when the rehearsal is clean, continue on production.

### Step 5. Adopt the baseline (bookkeeping only)

```sh
npm run migrate:baseline -- --confirm=<database name>                   # state A
npm run migrate:baseline -- --confirm=<database name> --accept-extra    # state B, after reviewing the extras
npm run migrate:show                                                    # baseline now [X]
```

This creates `typeorm_migrations` and one row. It creates, alters or drops no business object and changes no record.
Running it again prints "already recorded".

### Step 6. Run the pending migrations

```sh
npm run migrate:run -- --confirm=<database name>
npm run migrate:show       # every migration [X], "Up to date."
```

Post-run verification:

* `npm run migrate:check-baseline` now lists only the Sprint 5 objects as `unexpected` (expected for Identity and
  Operations and Core; Oversight still matches exactly). Only exact reviewed additions may appear.
* Identity: `\d accounts` shows `position character varying(100)` and the `accounts_position_ck` check.
* Operations: `\d transactions` shows `outcome`, `disapproval_reason`, `disapproval_notice_given`, `started_by_position`
  and `transactions_outcome_ck`.
* Row counts of business tables equal the step 1 counts.
* Oversight: the runtime service still writes (`ccms_logs_writer` grants are unchanged; nothing in this PR alters them).

After the isolated rehearsal, execute approved production steps only as BE Dev 1, after backup verification. Once
schema checks pass, merge/promote the reviewed commit and resume deployment according to the recorded procedure.
Verify the deployed commit and health checks. Exercise sign-in, start and completion using the separate QA environment;
do not introduce QA fixtures into the demo database.

### Step 7. Record in the PR

* Execution date and time (Asia/Manila), executor (BE Dev 1), repository commit.
* Backup method and identifier from step 1, and who verified it.
* For each database: starting state (A or B), the exact `check-baseline` and `migrate:show` output (it contains no
  credentials), and the exact migration names applied, e.g.
  `OperationsBaseline1793491200000 (adopted), Cc050TransactionOutcome1794182400000, Cc046StartedByPosition1794225600000`.

### Rollback

* **Before step 5:** nothing changed; stop.
* **After step 5, before step 6:** the only change is the bookkeeping table. To undo it:
  `DROP TABLE typeorm_migrations;` (the database is then exactly as before).
* **After step 6, data not yet written to new columns:** `npm run migrate:revert -- --confirm=<database>` once per
  migration, newest first. Each revert removes only its own columns; `migrate:revert` refuses on the baseline.
* **After step 6, values already written to new columns** (outcomes, positions): a revert deletes those values. It is
  refused unless `CCMS_ALLOW_DATA_LOSS=<migration name>` is set. Prefer leaving the columns (old code ignores them) and
  rolling back only the application deployment. If the schema really must go back, export the affected values first.
* **Anything unexpected:** restore from the step 1 backup (Neon: restore the branch / reset production from it; dump:
  `pg_restore` into a fresh database and repoint the service). This loses every write made after the backup, so keep
  the window short.

## 4. Adding a migration (developers)

1. Change the entity and write `apps/<service>/migrations/<Date.now()>-<Name>.js` with `up` and `down`; add it to the end
   of `migrations/index.js`. Prefer additive changes. For a column drop in `down`, call
   `assertColumnsEmptyBeforeDrop`.
2. Oversight: a new table must `GRANT` exactly the runtime access it needs (default privileges are revoked).
3. Test on a disposable database: `npm run migrate:run`, `migrate:revert`, `migrate:run`; and run
   `npm run test:safety`, which proves that a fresh migrated database equals the `db:sync` schema and that TypeORM has
   nothing left to synchronize.
4. Never run `db:sync` against a hosted database; it is refused.

## 5. Status and open items

Verified locally (disposable PostgreSQL 16 in Docker; never the hosted database):

* AC1 on isolated copies of the baseline schema with sample business rows: adoption changes only `typeorm_migrations`
  (identical schema fingerprint and row checksums); `migrate:show` reports the baseline applied; in state B the pending
  Sprint 5 migrations change no business schema or data; a copy with a missing column is reported and refused.
* AC2: CC046 (Identity), CC050 and CC046 (Operations) add their columns; `migrate:revert` removes them, newest first;
  reverting a column holding values is refused without `CCMS_ALLOW_DATA_LOSS`.
* AC3: `sync-db.js` of all four services exits 1 with `DB_TARGET=hosted` and the database stays empty.
* A fresh database initialised by `migrate:run` equals the `db:sync` schema of the current entities, with the same
  default rows, and TypeORM reports nothing left to synchronize.

Not verified, pending BE Dev 1:

* **AC1 on the real hosted schema**: `migrate:check-baseline` has never been run against the hosted databases. Whether
  they are in state A, B or C is unknown. Run step 3 (read-only) first; if it reports state C, see the fallback below.
* **AC5**: no backup evidence exists yet. Pending until BE Dev 1 records it (step 1).
* Hosted PostgreSQL version: the baseline was captured on PostgreSQL 16. A different major version can print some
  definitions differently and show false `changed` lines in step 3; review them before concluding state C.
* Whether `DB_SYNCHRONIZE=false` and `DB_TARGET=hosted` are set in each Vercel project.

**Fallback (approved).** If step 3 shows state C, or verification is blocked for more than about half a day: do not adopt.
Report to the PM (template below), and use the reviewed explicit scripts (`npm run migrate:sprint5`) plus a verified
backup for Sprint 5 in the meantime. Finish the migration framework later with a reviewed fix-up migration or a
re-captured baseline. Never use schema synchronization on the hosted database.

> PM update template: "TT1 migration framework is merged and tested on disposable databases. Hosted adoption is blocked:
> `migrate:check-baseline` on <service> reports <n> missing/changed objects (<summary>). Until a reviewed fix-up is
> ready, Sprint 5 schema changes go through the explicit `migrate:sprint5` script after a verified backup, per the
> approved fallback. No schema synchronization was or will be run on hosted."

### Integration coverage

This branch incorporates `e70fd8d` (Sprint 5-6 integration) and the outside-hours change. Numbered migrations cover
every database addition present in that code. Registry import and Oversight analytics/report storage are not yet
implemented by the merged backend: their frontend adapters are provisional or demo-backed. Do not invent tables or
claim those features are complete. Their eventual backend changes must append new migrations before deployment.

The pre-existing committed merge markers in Operations were resolved by retaining both starter labels and the
server-generated outside-hours flag. Tests verify that both behaviors coexist.

### Registry and historical seed dependencies (separate work)

1. Verify and adopt the hosted baseline, then run reviewed numbered migrations for the required features.
2. Import the mock registry through the normal registry import: 2,350 students and 1,200 alumni. The 12 invalid rows
   are rejection fixtures for the separate QA database, not demo records. CSV and XLSX are alternative representations,
   not two sets to import.
3. Complete per-office schedules (CC048) and the Operations-to-Oversight analytics feed/storage before historical seeding.
   Ensure the PM-created active office accounts and active PUP catalogue services exist; load the approved calendar
   independently. The history seed only reads it.
4. Follow `CCCMS_SEED_PLAN_V2_11082026.md`: about 700 completed records for July 1-November 6, 2026, plus 40-60 current
   open records; use existing office accounts and registry records, tracking suffixes 9001-9999, deterministic output,
   one import audit event per run, no mail or FMS/SCMS pushes, and no calendar writes. Feed every seeded transaction to
   analytics. This is a data-loading task, never part of a schema migration.
5. Add reports only when their feature/schema exists; complaints wait for Wave 2. Hosted imports belong to BE Dev 1,
   after a verified backup. No mock data is loaded by TT1.
