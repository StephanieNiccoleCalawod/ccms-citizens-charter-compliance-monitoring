# ccms-operations-service (Transaction)

Part of the Citizen's Charter Compliance/Monitoring System (CCMS). One service = one repository = one database (`ccms_operations`).
This service owns **transactions**: start with a standard snapshot, hold/resume, complete with compliance, cancel, the role-scoped list,
auto-close, the settings and counters, and the receipt email. **API only**: every screen lives in `ccms-frontend`; the browser reaches this
service through `ccms-api-gateway` (`/api/operations/*` arrives here as `/api/*`).

Stack: Next.js Route Handlers (JavaScript) · TypeORM · PostgreSQL 15+ · `ccms-shared` (vendored). Same layout as `ccms-core-service`.

```
src/app/api/        routes (health, settings, counters, transactions, jobs/*)
src/modules/transaction/   settings, counters, start, hold, complete, compliance, cancel, list, auto-close, compute-pending, receipt, core-client
src/jobs/           outbox-dispatch, compute-pending, auto-close, receipt-emails
src/lib/            data-source, entities, after-sync (constraints), outbox, mailer
test/               node:test (needs PostgreSQL: TEST_PG_URL)
```

## Run

```bash
cp .env.example .env.local
npm install
npm run migrate:run   # creates the tables on an empty local database (or: npm run db:sync, local only)
npm run dev      # http://127.0.0.1:3004/api/health  ->  { "status": "UP" }
```

## Database migrations (TypeORM, TT1)

Schema synchronization is refused with `NODE_ENV=production`, including local targets. The reconstructed baseline
requires verification against an isolated hosted copy before adoption. `--accept-extra` permits only exact reviewed
Sprint 5 definitions; arbitrary extras and incompatible definitions are refused.

The schema is defined by the numbered migrations in `migrations/` (entities in `src/lib/entities/` must match them). The
running service never changes the schema (`synchronize: false`; keep `DB_SYNCHRONIZE=false`).

| Command | What it does |
| --- | --- |
| `npm run migrate:show` | Read-only: each migration `[X]` applied or `[ ]` pending |
| `npm run migrate:run` | Applies pending migrations. On an empty database it runs the baseline and creates every table and the settings row |
| `npm run migrate:revert` | Reverts the latest migration (refuses the baseline; refuses to drop a column that holds values unless `CCMS_ALLOW_DATA_LOSS=<migration name>`) |
| `npm run migrate:check-baseline` | Read-only: compares the live schema with `migrations/baseline-schema.json` |
| `npm run migrate:baseline` | Existing database only: records the baseline as applied after verifying the schema. Bookkeeping only, no schema or data change |

Migrations, in order:

| Migration | Change | Reverting it |
| --- | --- | --- |
| `OperationsBaseline1793491200000` | The pre-Sprint-5 schema, including the Sprint 4 critical columns and checks | refused (restore the backup) |
| `Cc050TransactionOutcome1794182400000` | `transactions.outcome`, `disapproval_reason`, `disapproval_notice_given`, `transactions_outcome_ck` | deletes every recorded outcome and reason |
| `Cc046StartedByPosition1794225600000` | `transactions.started_by_position` | deletes every copied position |

**Baseline setup.** Empty database: `npm run migrate:run`. Existing database (including the hosted one): `migrate:check-baseline`,
then `migrate:baseline`, then `migrate:run`. A database where the interim `migrate:sprint5` already ran reports the four Sprint 5
columns and the outcome check as extra; adopt it with `npm run migrate:baseline -- --accept-extra` and `migrate:run` then changes
nothing.

**Hosted safeguards.** `db:sync` is local development only and is refused for `DB_TARGET=hosted` (or any non-loopback host
when `DB_TARGET` is unset) before connecting. Hosted writes need `DB_TARGET=hosted` and `--confirm=<database>`, and are run only
by BE Dev 1 after a verified backup: see [../../docs/database-migrations.md](../../docs/database-migrations.md).

## Environment

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL`, `DB_SYNCHRONIZE`, `DB_POOL_MAX` | own database `ccms_operations` (`DB_SYNCHRONIZE=false` always) |
| `DB_TARGET` | `local` or `hosted`; hosted refuses schema synchronization and requires `--confirm` for migrations |
| `IDENTITY_JWKS_URL`, `JWT_ISSUER`, `JWT_AUDIENCE` | token verification |
| `SERVICE_KEY` | shared service key (calls to Core) |
| `CORE_URL` | Core address, with or without `/api` |
| `LOGS_SERVICE_URL` | where audit events are delivered |
| `CRON_SECRET` | secret Vercel Cron sends to `/api/jobs/*` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | receipt email (CC024); empty host = nothing is sent |

## API (under `/api`)

| Route | Who |
| --- | --- |
| `GET /health` | anyone |
| `GET /settings`, `PUT /settings` | read: any role; change: Super Admin (version check, 409 `SETTINGS_VERSION_CONFLICT`) |
| `GET /counters?officeId=`, `POST /counters`, `PUT /counters/:id`, `PATCH /counters/:id/deactivate\|reactivate` | read: Super Admin, Office Head/Staff (own office); write: Super Admin |
| `POST /transactions`, `GET /transactions`, `GET /transactions/:id` | Super Admin, Office Head, Office Staff (scoped); Executive 403 |
| `POST /transactions/:id/hold`, `/resume`, `/complete` | who started it, Office Head of the office, Super Admin |
| `POST /transactions/:id/cancel` | Office Head (own office), Super Admin |
| `GET /jobs/outbox`, `/jobs/compute-pending`, `/jobs/auto-close`, `/jobs/receipt-emails` | `CRON_SECRET` only (not reachable through the gateway) |

Errors use `{ error: { code, message, details, correlation_id, timestamp } }`. Every change writes its audit event in the same
database transaction (outbox) and the outbox job delivers it.

## Notes

- Schema changes are numbered migrations in `migrations/` (TT1). `src/lib/after-sync.js` (constraints, partial unique indexes) is
  used only by the local `db:sync`; keep it consistent with the migrations (`npm run test:safety` at the root checks this).
- The standard, service, office and classification are copied onto the transaction at the start; Charter changes never change past results.
- Cron schedules in `vercel.json` are once a day (E20 open).
- `src/lib/mailer.js` is a small SMTP client written because Identity's mailer was not available; replace it with the shared mailer when it exists (only `send({ to, subject, text })` is used).
