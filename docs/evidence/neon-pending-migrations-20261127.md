# Pending Neon migrations — analysis (2026-11-27)

## Why this exists

The hosted site (`cccms.pupqc.tech`) is on Neon Postgres (confirmed in `docs/qa-environment.md` and
`docs/evidence/tt1-hosted-rehearsal-20261110.md`, which names real Neon branch IDs for the hosted Identity
and Oversight databases). `/offices` on the hosted site shows "Something went wrong. Please try again." then
"No offices yet." - exactly the symptom `SPRINT8-BE2-FE-HANDOFF-v3.md` §2a describes for a pending Core
migration that hasn't been run against the hosted database yet.

This file lists every migration that exists in the codebase at `HEAD` (branch `codebase-for-deployment`,
commit `7ea362d` and the pull it followed) for each of the four services, so whoever has Neon/hosting access
can check `migrate:show` against the real hosted databases and know what they're looking at.

**I do not have hosted Neon credentials or dashboard access.** Everything below comes from reading the
migration files and git history in this repo, not from querying the hosted databases directly. The "Pending?"
column is inferred, not confirmed - run `migrate:show` against each hosted database to get the real answer.

## How this was put together

1. Listed every file under each service's `migrations/` folder.
2. Cross-checked that list against what `SPRINT8-BE2-FE-HANDOFF-v3.md` already names as pending.
3. Used `git log` on each migration file to find which commit added it, to catch anything newer than the
   handoff doc's own knowledge (the handoff was written before this session's `git pull` on
   `codebase-for-deployment`, which brought in 5 more commits - see below).

## Headline finding: one migration the handoff doc doesn't know about

`apps/core-service/migrations/1795679000000-S864TermAcademicYear.js` was added by commit `c918180`
("S8-64: Store SMS-provided academic years"), part of 5 commits pulled into `codebase-for-deployment` in
this session, **after** `SPRINT8-BE2-FE-HANDOFF-v3.md` was written. The handoff doc only names
`S853OfficeBackdatePermission` and `S858ServiceHasFee` as pending for Core - it has no way to know about
this third one. **Treat it as a third candidate pending-migration for Core, in addition to the two the
handoff names.**

A related commit, `030085b` ("Fix Core migration rollback order for S8-64"), only changed a CI test file
(`scripts/migrations.test.mjs`) - it is not a schema fix, just a test-ordering fix, so it needs no separate
migration step.

The other 3 pulled commits (`015c762` S8-62, `b056e10` S8-57, `4b7ba53` Identity expiry fix) touch only
application code (validation messages, calendar rules, access-request date formatting), not schema - no new
migrations from those.

## Identity service

| Migration | Adds | Named by handoff doc? |
|---|---|---|
| `1793491200000-IdentityBaseline` | Baseline schema | already applied, presumably |
| `1794225600000-Cc046AccountPosition` | — | already applied, presumably |
| `1794300400000-Cc046TrimmedPosition` | — | already applied, presumably |
| `1794650000000-Cc056PermissionSwitches` | `permission_switches`, `account_last_login` tables | already applied, presumably |
| `1795100000000-ClerkAccountLinks` | — | already applied, presumably |
| **`1795200000000-Def19OptionalEmployeeNo`** | `accounts.employee_no` becomes nullable (still unique) | **Yes - named pending** |
| `1795300000000-ClerkInvitations` | — | already applied, presumably |
| **`1795400000000-AccessRequests`** | New tables `access_requests`, `account_permission_grants` (S8-52) | **Yes - named pending** |

No migrations newer than `AccessRequests` exist in the repo for Identity, so nothing beyond what the handoff
already names.

## Core service

| Migration | Adds | Named by handoff doc? |
|---|---|---|
| `1793491200000-CoreBaseline` | Baseline schema | already applied, presumably |
| `1794300000000-Cc048OfficeSchedules` | — | already applied, presumably |
| `1794441700000-Cc058CalendarReasons` | — | already applied, presumably |
| `1794528000000-Cc047AllowedClientTypes` | — | already applied, presumably |
| **`1795478500000-S853OfficeBackdatePermission`** | `offices.allow_backdated_transactions boolean DEFAULT false` | **Yes - named pending** |
| **`1795478600000-S858ServiceHasFee`** | `services.has_fee boolean DEFAULT true` | **Yes - named pending** |
| **`1795679000000-S864TermAcademicYear`** | `term_dates.academic_year text` (nullable; SMS fills it in later) | **No - not in the handoff doc (see headline finding above)** |

These are a likely match for the `/offices` failure specifically: the Offices page reads `offices` rows, and
`S853` is the migration that changes that exact table. `S858` (services) and `S864` (term_dates) explain why
the doc also warns Services and Working hours can fail the same way.

## Oversight service

| Migration | Adds |
|---|---|
| `1793491200000-OversightBaseline` | Baseline schema |
| `1794355300000-Tt2AnalyticsTransactions` | — |
| `1794528400000-Tt1AnalyticsTombstones` | — |
| `1794600000000-Cc032Complaints` | — |
| `1794700000000-Cc029Reports` | — |
| `1794800000000-Cc034ComplaintHandling` | — |
| `1794900000000-Cc040QueueWait` | — |
| `1794900100000-Cc032RateLimitKeyName` | — |
| `1795000000000-Cc055NotificationReads` | `notification_reads` (reused by the delete-notification feature in handoff batch 25) |

The handoff doc states explicitly: *"Oversight and Operations need no new migration from these batches (the
delete in batch 25 reuses the `notification_reads` table)."* No migration newer than `Cc055NotificationReads`
exists in the repo, and this session's own work added no Oversight migrations either. **Still worth an
independent `migrate:show` against hosted Oversight** - nothing in this analysis confirms its migrations
table is actually caught up, only that the repo has nothing newer to apply.

## Operations service

| Migration | Adds |
|---|---|
| `1793491200000-OperationsBaseline` … through … `1795478400000-S850TrainingExclusions` | (16 migrations total - see `apps/operations-service/migrations/`) |

Same situation as Oversight: the handoff doc says no new migration is needed from batches 3-26, and nothing
in this session's work (or the later git pull) added an Operations migration. `1795478400000-S850TrainingExclusions`
is the newest file in the repo. **Still worth an independent `migrate:show` against hosted Operations** for
the same reason as Oversight.

## How to actually check and apply (for whoever has Neon access)

This repo refuses to write to a hosted database unless the operator is explicit about it (see
`packages/ccms-shared/src/migrations.js`): `DB_TARGET=hosted` must be set, and a write command needs
`--confirm=<database name>` matching the database the connection string actually points at - this is a
safety check against running a migration on the wrong target by accident.

For each service (**Identity first, then Core**, per the handoff's own order; Oversight and Operations after,
to be thorough):

```bash
cd apps/<service>
# one-time, in the shell: point DATABASE_URL at that service's hosted Neon connection string (the direct
# endpoint, not the "-pooler" alias), and set DB_TARGET=hosted
npm run migrate:show
# read the pending list, then, only if something is actually pending:
npm run migrate:run -- --confirm=<database name from the connection string>
```

Restart (or redeploy) the service afterwards so it picks up the new schema, then re-check the page that was
failing.

## Open items

- Confirm `migrate:show` against hosted Core actually lists all three of `S853`, `S858` and `S864` as
  pending (this doc only shows what the repo *could* apply, not what hosted already has).
- Confirm `migrate:show` against hosted Identity lists `Def19OptionalEmployeeNo` and `AccessRequests` as
  pending, per the handoff doc.
- Run `migrate:show` against hosted Oversight and Operations as a sanity check, even though nothing in the
  repo suggests they need it.
