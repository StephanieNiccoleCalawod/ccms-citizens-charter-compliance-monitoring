# CCMS monorepo

Citizen’s Charter Compliance Monitoring System: six independent Next.js applications and one shared ESM library, managed with npm workspaces. The repository's original README is preserved in [docs/migration/ORIGINAL-README.md](docs/migration/ORIGINAL-README.md).

## Prerequisites

- Node.js 22.14 or later and npm 10 or later. Node 22 is used in CI. The migration was verified with the versions listed in [verification](docs/migration/VERIFICATION.md).
- Docker Desktop with its Linux engine running for the optional local PostgreSQL setup, or four separate disposable PostgreSQL 16 databases.
- Internet access for initial npm installation and Next.js Google font downloads during frontend builds.

Install from this directory, which contains the root `package.json`:

```sh
npm ci
npm run env:init
```

`env:init` writes `apps/<application>/.env.local` from each application's `.env.example`, generates a matching service key and job secret, and generates a stable local Identity RSA key. It never overwrites an existing local environment file. If only some files exist, it stops without changing files: copy the missing examples manually and reuse the existing service key. If all files exist, it leaves them unchanged. Environment files and private keys are ignored by Git and excluded from the release ZIP. Example database passwords are public placeholders for disposable local development only.

## Workspaces and ports

| Workspace | Port | Purpose |
| --- | --- | --- |
| `apps/frontend` | 3000 | Browser UI; `/api/*` forwards to gateway |
| `apps/api-gateway` | 8080 | Authentication and routing to services |
| `apps/identity-service` | 3001 | Accounts, tokens, authentication |
| `apps/oversight-service` | 3002 | Append-only audit log |
| `apps/core-service` | 3003 | Catalogue, offices, calendar, working-time engine |
| `apps/operations-service` | 3004 | Transactions and receipts |
| `packages/ccms-shared` | — | Shared auth, permissions, time, audit and test helpers |

The root `package-lock.json` is the only lockfile. Install dependencies at the root. Each application's package manifest and original commands remain available through `npm run <command> --workspace=apps/<application>`. Shared source is consumed directly through package exports, so no shared compilation is necessary. `build:shared` verifies those exports before application builds.

## Local databases

```sh
npm run db:up
docker compose -f compose.local.yml ps
```

Wait for all four servers to report healthy. This Compose project creates four independent servers and persistent volumes; it neither connects to existing databases nor merges their schemas. Ports bind to loopback only.

| Service | Local PostgreSQL port | Database / owner |
| --- | --- | --- |
| Identity | 5433 | `ccms_identity` |
| Core | 5435 | `ccms_core` |
| Operations | 5436 | `ccms_operations` |
| Oversight | 5437 | `ccms_oversight` |

For these local servers, the example owner password is `<database>_dev_pw`. Oversight uses the separate `ccms_logs_writer` runtime role; its owner connection belongs in `DATABASE_ADMIN_URL`. `db:sync` provisions the audit roles/grants using `LOGS_WRITER_PASSWORD` and `OVERSIGHT_APP_PASSWORD`. Runtime keeps INSERT/SELECT access; do not replace its connection with the owner URL.

Oversight's provisioning owner needs `CREATEROLE`, `CREATEDB`, and administrative permission over pre-existing audit runtime roles to harden their attributes. The provided local Docker owner has these capabilities. They belong only to the administrative connection, never `ccms_logs_writer`.

On **fresh disposable local databases**, explicitly create the schema:

```sh
npm run db:sync
```

`db:sync` runs Oversight first, then Identity, Core and Operations. Individual examples:

```sh
npm run db:sync --workspace=apps/core-service
npm run migrate --workspace=apps/identity-service
npm run migrate:sprint4 --workspace=apps/operations-service
```

`npm run db:migrate` runs each original `migrate` command, which aliases TypeORM schema synchronization. It is not a versioned migration runner. `npm run db:migrate:sprint4` runs the existing idempotent critical migrations for Oversight, Core and Operations. Original schema preparation, post-sync constraints, grants, triggers, and migration files are preserved. Core's schema sync also runs the existing seeding-model conversion first, which can stop for ambiguous legacy data. For existing data, back up and review these original commands before invoking them: TypeORM synchronization can alter/drop schema objects. No migration is triggered by `dev`, `start`, `build` or install.

Set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` in Identity's `.env.local`, then explicitly create the first administrator:

```sh
npm run bootstrap:admin --workspace=apps/identity-service
```

Core catalogue setup/seeding remains optional and explicit. Set `CCMS_SEED_ACTOR_ID` in Core's `.env.local` to that authorized Super Admin's account UUID before running:

```sh
npm run setup:pup --workspace=apps/core-service -- --actor YOUR_SUPER_ADMIN_ACCOUNT_UUID
npm run db:bootstrap --workspace=apps/core-service
```

This command synchronizes schema, recodes offices and imports reviewed seeds. Review Core's own documentation before using it on an existing database. Other independent commands (`seed`, `seed:holidays`, `setup:pup`, `freeze:offices`, `readiness`, and `recode:pup-offices`) remain in Core's package manifest.

`npm run db:down` stops only this Compose project's servers and preserves volumes. No reset/delete-volume command is part of ordinary startup.

## Start and check

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The root runner starts six processes, preserves service working directories and ports, and terminates sibling processes when one fails or when interrupted. Root startup forces `DB_SYNCHRONIZE=false`; all four runtime data sources explicitly disable schema synchronization, including individual startup even if a local file requests it. Runtime also disables TypeORM’s automatic PostgreSQL extension installation. Explicit administrative commands still override these settings. Core's former automatic `predev` bootstrap was removed.

Run one application or use its original independent commands:

```sh
npm run dev:frontend
npm run dev:api-gateway
npm run dev:identity-service
npm run dev:oversight-service
npm run dev:core-service
npm run dev:operations-service
npm run keygen --workspace=apps/identity-service
```

Build before using the local production-mode server:

```sh
npm run build
npm start
```

Existing checks are available at root and per workspace:

```sh
npm run lint
npm run check:time
npm test
npm run ci
npm test --workspace=packages/ccms-shared
```

Database tests create and drop uniquely named temporary databases. Use a **dedicated disposable local test server**, never a production or personal application database server. Their default admin connection is `postgres://postgres:postgres@127.0.0.1:55432/postgres`. To create one isolated test server:

```sh
docker run --name ccms-monorepo-tests --rm -d -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine
npm test
docker stop ccms-monorepo-tests
```

Alternatively set `TEST_PG_URL` in the shell to your dedicated test server. Tests do not automatically load application `.env.local` files. The root CI workflow provisions its own disposable test PostgreSQL instance, installs once, then runs lint, time checks, tests, builds, and dependency audits. It performs no deployment.

Frontend `tests/e2e/*.cjs` scripts remain available for manual browser checks; they are not included in the original unit-test command. They may require Playwright browsers, a seeded running stack, and administrator credentials. Do not assume they passed unless recorded in the verification report.

## Environment and integrations

Each application reads its own `apps/<application>/.env.local`; there is no shared root `.env`. Gateway upstream URLs and frontend rewrite default to the local ports above. All protected services use Identity's JWKS endpoint with the existing issuer/audience and the same service key for internal calls. Keep `VERIFY_TOKENS` enabled.

SMTP/HTTP mail, calendar consumers (`FMS_URL`, `AUDIT_URL`, optional `SMS_URL`), and authenticated job calls remain optional external integrations. Core's `npm run mocks --workspace=apps/core-service` starts local calendar receiver mocks on 4101/4102. Background outbox/mail/calendar jobs are HTTP job endpoints; startup does not schedule them automatically. Local job callers must supply the configured `CRON_SECRET` in the Authorization header. The [local job inventory](docs/local-jobs.json) lists every endpoint and preserves the original cron expressions as historical reference; automatic scheduling is disabled.

The [source inventory](docs/migration/source-inventory.json) records original dependencies, scripts, environment variables (including test variables), cross-package imports, and schema/migration files for every archive. Shared database/auth variables also apply to backend consumers. [Shared consolidation](docs/migration/SHARED-CONSOLIDATION.md) explains the reconciled vendor differences. Source application READMEs are preserved as historical references; this root README governs monorepo paths, safe startup, and local operation. Deployment manifests from the archives were omitted; no deployment configuration was added.

## Troubleshooting

- **Port already in use:** inspect the occupying process before stopping anything. Defaults are intentionally preserved. Database examples must match your chosen local PostgreSQL ports.
- **Docker pipe/daemon error:** start Docker Desktop's Linux engine, then retry `db:up`. Check `docker compose -f compose.local.yml ps`.
- **Missing tables:** run the owning service's explicit `db:sync` on a fresh local database. Do not turn runtime schema synchronization on to fix an existing database blindly.
- **Audit permission errors:** provision Oversight using its owner URL, then run it as `ccms_logs_writer`. Existing privileged runtime roles are deliberately rejected by provisioning.
- **Authentication fails after restart:** use a persistent `JWT_PRIVATE_KEY` in Identity's local file, matching issuer/audience across services. Ensure all service keys match.
- **`ccms-shared` cannot resolve:** run `npm ci` from the root. Do not copy vendors or add nested lockfiles.
- **Font download failure during frontend build:** Next.js downloads the existing Google fonts. Check network access; no local-font redesign is included.
- **Database test connection refused:** start the disposable test server on 55432 or export `TEST_PG_URL`. Test failures are not proof of a broken application until database availability is established.

See [verification results and limitations](docs/migration/VERIFICATION.md) for exactly what was executed.
