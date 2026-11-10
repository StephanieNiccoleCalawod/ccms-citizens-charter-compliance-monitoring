# ccms-oversight-service (Logs)

Part of the Citizen's Charter Compliance/Monitoring System (CCMS). One service = one repository = one database (`ccms_oversight`).
This service keeps the **audit trail**: it receives audit events from the other services, stores them once and never changes them,
and lets the Super Admin (all entries) and Office Heads (their own office) read them. **API only**: the Logs screens live in
`ccms-frontend`; the browser reaches this service through `ccms-api-gateway` (`/api/logs/*` arrives here as `/api/*`).
Only the `logs` module exists now (Sprint 4: TT2, CC005, CC019, CC020); reports and analytics come in Sprints 5-6.

Stack: Next.js Route Handlers (JavaScript) · TypeORM · PostgreSQL 15+ · `ccms-shared` (vendored). Same layout as `ccms-core-service`.

```
src/app/api/        routes (health, audit-events)
src/modules/logs/   audit-events (validate + store), list (the viewer query)
src/lib/            data-source, entities (AuditLog), after-sync (indexes, CHECK, roles, grants)
test/               node:test (needs a disposable PostgreSQL cluster: TEST_PG_URL)
```

## Run

```bash
# 1. a PostgreSQL database named ccms_oversight whose owner is ccms_oversight
docker run -d --name ccms-oversight-db -e POSTGRES_USER=ccms_oversight -e POSTGRES_PASSWORD=ccms_oversight_dev_pw \
  -e POSTGRES_DB=ccms_oversight -p 5437:5432 -v ccms_oversight_data:/var/lib/postgresql/data postgres:16

cp .env.example .env.local
npm install
npm run migrate:run  # empty database: creates audit_log, the two roles and the grants (connects as the owner)
                     # (or: npm run db:sync, local only)
npm run dev          # http://127.0.0.1:3002/api/health  ->  { "status": "UP" }
```

## Database migrations (TypeORM, TT1)

Schema synchronization is refused with `NODE_ENV=production`, including local targets. The reconstructed baseline
requires verification against an isolated hosted copy before adoption. This service permits no extra schema objects
during adoption; `--accept-extra` cannot bypass unknown objects.

The schema is defined by the numbered migrations in `migrations/`. Every migration command connects as the schema owner
(`DATABASE_ADMIN_URL`, falling back to `DATABASE_URL`); never point it at `ccms_logs_writer`. The running service never changes
the schema (`synchronize: false`; keep `DB_SYNCHRONIZE=false`).

| Command | What it does |
| --- | --- |
| `npm run migrate:show` | Read-only: each migration `[X]` applied or `[ ]` pending |
| `npm run migrate:run` | Applies pending migrations. On an empty database it runs the baseline: `audit_log`, its indexes and checks, then the two runtime roles and grants exactly as `db:sync` provisions them |
| `npm run migrate:revert` | Reverts the latest migration (the baseline cannot be reverted: restore the backup instead) |
| `npm run migrate:check-baseline` | Read-only: compares the live schema, including the `audit_log` grants, with `migrations/baseline-schema.json` |
| `npm run migrate:baseline` | Existing database only: records the baseline as applied after verifying the schema. Bookkeeping only: no schema, grant, role or row change |

Migrations: `OversightBaseline1793491200000` only (the pre-Sprint-5 schema, including the Sprint 4 `entity_name` column and check).
A later migration that adds a table must `GRANT` exactly the runtime access it needs.

**Baseline setup.** Empty database: `npm run migrate:run`. Existing database (including the hosted one): `migrate:check-baseline`,
then `migrate:baseline`; `migrate:run` then reports nothing pending. If the grants differ from the baseline, `check-baseline`
reports them; do not adopt until they are reviewed.

**Hosted safeguards.** `db:sync` is local development only and is refused for `DB_TARGET=hosted` (or any non-loopback host when
`DB_TARGET` is unset) before connecting. Hosted writes need `DB_TARGET=hosted` and `--confirm=<database>`, and are run only by
BE Dev 1 after a verified backup: see [../../docs/database-migrations.md](../../docs/database-migrations.md).

`TEST_PG_URL` must point to a disposable test PostgreSQL cluster, not the local or hosted Oversight cluster. The security tests
create temporary databases and provision the cluster-wide `ccms_logs_writer` and `ccms_oversight_app` roles with test passwords.

## Database roles (TT2, D6)

The baseline migration (empty databases) and the local `npm run db:sync` both connect as the schema owner (`DATABASE_ADMIN_URL`)
and, in `src/lib/after-sync.js`:

| Role | Rights on `audit_log` | Used by |
| --- | --- | --- |
| `ccms_logs_writer` | INSERT, SELECT | this service when it runs (`DATABASE_URL`) |
| `ccms_oversight_app` | SELECT | the future reports and analytics |
| everyone else (PUBLIC) | no database, schema, or table access | |

The running service uses `ccms_logs_writer` and `DB_SYNCHRONIZE=false`, so no application role can change or delete a past entry.
Provisioning also revokes the database's default `PUBLIC` access, including `CONNECT` and `TEMPORARY`, removes runtime-role
memberships, sets both runtime roles to `NOINHERIT` with no administrative attributes, and revokes schema creation. This prevents
another CCMS database credential from entering Oversight when services share a PostgreSQL cluster.
The schema owner keeps the rights every table owner has and must never be the role the service runs as. On Neon, create the
database and the owner role in the console first; on an empty database `migrate:run` creates the two roles and sets their
passwords from `LOGS_WRITER_PASSWORD` and `OVERSIGHT_APP_PASSWORD` (`db:sync` is refused on Neon).

## API (under `/api`)

| Route | Who |
| --- | --- |
| `GET /health` | anyone (503 when the database is unreachable) |
| `POST /audit-events` | **service key only** (`x-service-key`); the gateway never forwards a browser POST here |
| `POST /analytics-events` | **service key only** (TT2); at most 500 events / 1 MiB; the gateway blocks it for every method and alias |
| `GET /jobs/analytics-backfill` | `CRON_SECRET` only (TT2); one bounded backfill run |
| `GET /audit-events?actor=&action=&entity_type=&office_id=&from=&to=&page=&page_size=` | Super Admin: all entries. Office Head: own office only. Office Staff, Executive: 403 |

`POST /audit-events` takes exactly what `recordAudit` (ccms-shared) sends: `audit_id, actor_user_id, actor_role, action, entity_type,
entity_id, office_id, before_value, after_value, ip_address, occurred_at`. Answers `201 { audit_id, stored: true }`, or
`200 { audit_id, stored: false }` when that `audit_id` was stored before (the first version is kept); `400 VALIDATION_ERROR` with field
details; `401`; `413` over 256 KB. The senders keep an invalid event in their outbox and retry it, with the error visible to developers.

`GET /audit-events` answers `{ items, page, page_size, total }`, newest first (`occurred_at DESC`). Filters combine with AND; `from` and
`to` are Manila dates (`from` 00:00:00 to `to` 23:59:59). The API applies no default date range: the Logs page sends the last 30 days.
Errors use `{ error: { code, message, details, correlation_id, timestamp } }`.

## Turning on delivery (TT2-T3)

Set `LOGS_URL` in `ccms-api-gateway` and `LOGS_SERVICE_URL` in Identity, Core and Operations to this service (`http://127.0.0.1:3002`
for the gateway, `http://127.0.0.1:3002/api` for the others) and use the same `SERVICE_KEY` everywhere. The waiting events are then sent
oldest first, 50 per cron run of each sender (once a day on the current plan, E20); a developer can call a sender's `/api/jobs/outbox`
with its `CRON_SECRET` to send a batch at once. Re-sent events are ignored by `audit_id`.

## Analytics projection (Sprint 5 TT2)

`analytics_transactions` holds the latest analytics snapshot per transaction (highest `event_version` wins; `is_seeded` derived
from the tracking number, K16). `analytics_backfill_state` holds the backfill cursor and lease. `ccms_logs_writer` gets SELECT,
INSERT and UPDATE on both (no DELETE/TRUNCATE); `ccms_oversight_app` gets SELECT on the projection; `audit_log` grants are unchanged.
Backfill: `npm run analytics:backfill` (CLI, `--max-pages=N`, `--reset`, hosted needs `DB_TARGET=hosted --confirm=<database>`) or the
job route. New variables: `OPERATIONS_SERVICE_URL`, `CRON_SECRET`. Details: [../../docs/analytics-feed.md](../../docs/analytics-feed.md).

## Notes

- The logs module has no outbox and never sends audit entries out (BR-LOG-001): audit entries never leave CCMS. The only
  outbound request is the TT2 backfill reading the Operations analytics export.
- Indexes: `(occurred_at DESC)`, `(office_id, occurred_at DESC)`, `action`, `entity_type`, `actor_user_id`. A CHECK requires a user unless
  `actor_role = 'system'`. There are no foreign keys (user and office are plain IDs from other services).
- Schema changes are numbered migrations in `migrations/` (TT1). `src/lib/after-sync.js` (constraints, indexes, grants) is used by
  the local `db:sync` and, for the grants, by the baseline; `npm run test:safety` at the root checks that both build the same schema.
