# ccms-identity-service

Part of the Citizen's Charter Compliance/Monitoring System (CCMS). One service = one repository = one database (`ccms_identity`).
Identity signs people in, issues and refreshes tokens, publishes the public keys that every service uses to check tokens,
manages accounts (create, edit, suspend, reset password) and asks Core whether an office exists.

**API only.** This repository has no screens: sign-in, password reset and Accounts are pages of `ccms-frontend`. The browser reaches
this service only through `ccms-api-gateway` (`/api/identity/*` arrives here as `/api/*`).

Stack: Next.js Route Handlers (plain JavaScript, no TypeScript) · TypeORM · PostgreSQL (Neon when deployed). Deployed as its own
Vercel project.

```
ccms-identity-service/
├── src/
│   ├── app/api/            # Route Handlers: auth/, accounts/, health, jobs/outbox
│   ├── jobs/               # outbox-dispatch.js: runs once, then returns
│   └── lib/                # accounts, auth-service, tokens, passwords, mailer, cookies, entities/, data-source.js, outbox.js
├── vendor/ccms-shared/     # the shared library, vendored (see the root README)
├── scripts/                # sync-db.js, bootstrap.js, generate-jwt-key.js
├── test/                   # node:test tests
├── vercel.json             # cron schedule
└── next.config.js
```

## Run it

```bash
cp .env.example .env.local     # or use ccms-local-stack, which does this for every service
npm install
npm run db:sync                # creates the tables
BOOTSTRAP_ADMIN_EMAIL=admin@ccms.local BOOTSTRAP_ADMIN_PASSWORD='choose-a-strong-one' npm run bootstrap:admin
npm run dev                    # http://127.0.0.1:3001/api/health
```

Open the system through the frontend (`http://localhost:3000`), not this port.

## Serverless rules (Vercel)

- **Signing key.** `JWT_PRIVATE_KEY` is required when deployed. Every instance must use the same key, so create it once with
  `npm run keygen` and paste it into the Vercel project's environment variables. Without it Identity refuses to start in production
  (in development it makes a temporary key).
- **Scheduled work is a route.** Vercel Cron calls `GET /api/jobs/outbox` with `Authorization: Bearer $CRON_SECRET`. No secret configured
  = it never runs; wrong secret = 401. It sends one batch of audit events to Logs and returns `{ job, sent, failed }`. After a change
  commits, one dispatch is also run right after the response (`after()`), so cron is the safety net. Claiming rows is atomic
  (`SKIP LOCKED` with a lease), so overlapping runs never send an event twice. `vercel.json` uses a once-a-day time so it deploys on any
  plan; change it to `*/5 * * * *` if your plan allows.
- **Cookies.** The refresh token is an httpOnly cookie scoped to `/api/identity/auth`. It works because the browser talks to one
  address (the frontend), which forwards `/api/*` to the gateway.
- **One small pool per instance** and TLS for Neon: see `DB_POOL_MAX`, `DATABASE_SSL`, `sslmode=require` in `.env.example`.

## Database (TypeORM, auto-created)

Tables are created from the entities in `src/lib/entities/` when the service first connects (`npm run db:sync` does it without
starting the app). There are no migration files: after the first deploy you may set `DB_SYNCHRONIZE=false` and run `npm run db:sync`
whenever the entities change, so cold starts do not re-check the schema.

## Auth

Every route uses `requirePermission(roles, officeScope)` from `ccms-shared`. Tokens are verified offline
against Identity's public keys (`IDENTITY_JWKS_URL`). Backend-only endpoints use the shared service key.
Errors always use `{ error: { code, message, details, correlation_id, timestamp } }`.

`POST /api/auth/login` accepts `{ "email": "staff@pup.edu.ph", "password": "..." }`. Five failed attempts
per normalized email or per client address are allowed in each 15-minute window; the sixth returns
`429 RATE_LIMITED` with `Retry-After`. Successful sign-ins do not consume either failure budget. If the
shared limiter store is unavailable, sign-in fails closed with `503 SIGN_IN_UNAVAILABLE` and issues no token.

`POST /api/auth/refresh` reads the `ccms_refresh` HttpOnly cookie (or `refresh_token` in a JSON body for API
clients). A successful refresh atomically revokes the presented token, creates a replacement, returns a new
access token, and sets the replacement cookie. Reusing an expired, revoked, or rotated token returns
`401 INVALID_REFRESH_TOKEN` and clears the cookie.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js (port 3001) |
| `npm run keygen` | Prints a new `JWT_PRIVATE_KEY` line |
| `npm run bootstrap:admin` | Creates the first Super Admin from `BOOTSTRAP_ADMIN_*` variables |
| `npm run lint` | ESLint |
| `npm run check:time` | Fails on server-local date methods (use the Asia/Manila helpers in `ccms-shared`) |
| `npm test` | node:test (needs a PostgreSQL server; set `TEST_PG_URL`) |
| `npm run db:sync` | Create/update tables from the entities |
| `npm run ci` | lint, check:time, test, build |

`ccms-shared` is vendored in `vendor/ccms-shared` and installed as a copy (`install-links=true` in `.npmrc`).
