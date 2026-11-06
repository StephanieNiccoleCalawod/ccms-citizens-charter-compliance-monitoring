# ccms-shared

The library every CCMS service uses, kept in one place and **vendored** into each repository that needs it (`vendor/ccms-shared`),
so every Vercel project installs it with no private registry and no sibling folder.

Contents: roles and permissions, token verification (RS256 / JWKS), the standard error format and `route()` wrapper, correlation ids,
the service key helpers, the TypeORM data source (`getDataSource`, pooled, TLS for Neon), the audit outbox (`recordAudit`,
`dispatchOutbox` with an atomic claim), the **public rate limiter** (`createRateLimiter` with a memory store for tests and a database
store, table `rate_limit_hits`), the **cron route helper** (`cronRoute`, `requireCronSecret`), Asia/Manila time helpers, the shared
navigation table (`ccms-shared/nav`) and test helpers (`ccms-shared/testing`).

Nothing in here starts a timer or a background process: `dispatchOutbox` sends one batch and returns.

```bash
npm install
npm test        # needs PostgreSQL: TEST_PG_URL, default postgres://postgres:postgres@127.0.0.1:55432/postgres
```

When you change this library, run `npm run sync-shared` in `ccms-local-stack` to copy it into each repo's `vendor/ccms-shared`.
