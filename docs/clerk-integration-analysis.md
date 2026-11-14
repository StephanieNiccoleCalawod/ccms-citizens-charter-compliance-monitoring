# CCMS — Clerk Authentication Integration Analysis

> ## Start here (status as of 2026-11-14)
>
> **Direction: "Landas 1".** Clerk proves who a person is; CCMS keeps deciding what they may do.
> - The **Identity service** verifies the Clerk session token with the instance's **public key only (no Clerk Secret Key)**.
> - After a **Super Admin approves** a person (bound by Clerk issuer + user ID, never by email), Identity issues the usual CCMS access token.
> - Gateway, Core, Operations and Oversight are unchanged.
> - This follows the FMS · SMS · CCCMS *Shared Clerk Access Playbook* (rules R1-R8).
>
> | Read | For |
> |---|---|
> | **Section 18** | The approved design, the decisions and the playbook alignment |
> | **Section 19** | What is built, how it was verified, the local test, the production runbook, open items |
> | Sections 1-17 | How the decision was reached (current auth audit, Clerk docs validation, provider answers). Their recommendations that involve a Clerk Secret Key, Clerk metadata for roles, `createUser`, or binding by email are **superseded** by Section 18 |
>
> **Code:** branch `feat/cccms-clerk-landas1`. Everything is behind switches that default to off:
> - Identity: `CLERK_AUTH_ENABLED`
> - Frontend: `NEXT_PUBLIC_AUTH_PROVIDER=legacy|dual|clerk`
>
> With the switches off, CCMS behaves exactly as before.
>
> **Configuration checker:** `node scripts/clerk-config-check.mjs <config.json>` (Section 15.2.3).

**Original scope (Sections 1-17):** analysis only. Nothing was changed while they were written.
**Codebase inspected:** `codebase-for-deployment` @ `7622083` (after the 2026-11-13 pull).

**Legend.** Every statement is tagged:
- **[V]** Verified in the code (file reference given).
- **[A]** Assumption or external fact not verifiable from the repo. Must be confirmed before building.
- **[R]** Recommendation (my design judgment).

---

## 1. Executive Summary

**Can Clerk replace CCMS authentication without a separate auth backend? Yes for authentication. No for the account directory.**

- CCMS authentication is a self-contained, home-built system inside the Identity service: scrypt passwords, RS256 JWTs, rotating refresh tokens, and a JWKS endpoint [V]. Every other service (gateway, Core, Operations, Oversight) trusts only a JWT with claims `sub, role, office_id, employee_no, full_name` [V `packages/ccms-shared/src/auth.js:67-78`].
- The Identity service also owns things Clerk does not replace: the `accounts` table (role, office, position, employee number, active flag), the four CC056 staff permission switches, the audit trail of account changes, and internal routes used by Operations (`/internal/office-accounts`, `/internal/permission-switches`) [V]. **Identity must stay as a small accounts/authorization service. What can be retired is its login, refresh, logout, JWKS, password and reset machinery.**
- Clerk authenticates "who is this person". CCMS keeps deciding "what may they do" using its own `accounts` row. Clerk must not become the source of truth for role or office [R].

**Recommended architecture [R]:** Clerk issues the session JWT. A customized session token carries the CCMS claims (`account_id`, `role`, `office_id`, `employee_no`, `full_name`) copied from the CCMS `accounts` row into Clerk `public_metadata`. The shared verifier (`ccms-shared` `authenticate`) and the gateway `tokenCheck` accept the Clerk JWT (issuer = your Clerk Frontend API URL, JWKS from Clerk), and the token's `account_id` is mapped to `user.id`, so all 170+ downstream uses of `user.id` and `started_by` keep working with no data change.

**Production safety [R]:** all schema change is one additive nullable column (`accounts.clerk_user_id`). The legacy login stays fully working in a **dual-verify** period (gateway and services accept both Identity-signed and Clerk-signed tokens). Existing sessions are never invalidated. Rollback is a feature-flag flip. Nothing is deleted until a later, separately approved cleanup.

**The three things most likely to hurt if skipped:**
1. Existing passwords **cannot** be carried into Clerk by the normal path (see 5.4). Plan for an invite or "set your password" step for every user.
2. Clerk matching must be by **verified** email and sign-up must be closed to the public, or someone can claim a staff account by registering the same address (see 8).
3. The Clerk **production** instance is bound to the production domain and has its own user pool. A real staging test needs a Clerk **development** instance (separate users), or you test on production for the first time (see 9).

---

## 2. Existing Authentication Architecture (verified)

### 2.1 Flow
```
Browser (apps/frontend)
  1. POST /api/identity/auth/login {email,password}   [frontend rewrites /api/* -> gateway]
        gateway (public route) -> Identity
  2. Identity: lookup lower(email), scrypt verify, issue
        access token  = RS256 JWT, 15 min, claims in body
        refresh token = opaque, 7 days, SHA-256 hashed in DB, httpOnly cookie ccms_refresh
           (SameSite=Strict, Path=/api/identity/auth)
  3. Browser keeps access token in memory + sessionStorage, plus marker cookie ccms_signed_in
  4. Every call: Authorization: Bearer <access>  -> gateway verifies signature/exp/iss/aud (RS256, JWKS)
        -> forwards to service -> service re-verifies (requirePermission) and checks role/office
  5. Near expiry: POST /auth/refresh rotates the refresh token (single-use, row locked) and re-reads role/office
```
Sources: `apps/identity-service/src/lib/auth-service.js`, `tokens.js`, `cookies.js`, `config.js`; `apps/frontend/src/lib/auth/session.js`; `apps/api-gateway/src/lib/{auth,gateway,instance}.js`.

### 2.2 Key facts
| # | Finding | Evidence |
|---|---|---|
| 1 | Passwords hashed `scrypt$<salt>$<hash>` (Node `crypto.scrypt`, 16-byte salt, 64-byte key); min 8 chars, max 200. | [V] `identity-service/src/lib/passwords.js` |
| 2 | Access token 15 min, refresh 7 days (env-tunable). Claims: `sub`=account UUID, `employee_no`, `full_name`, `role`, `office_id`. iss `ccms-identity`, aud `ccms`. | [V] `tokens.js:35-50`, `config.js` |
| 3 | Role and office travel **in the token**. Services trust the claims. A role change is effective on the next refresh (≤15 min); a deactivated user keeps a valid access token up to 15 min but cannot refresh. | [V] `shared/auth.js:67-78`, `auth-service.js:53-70`, `accounts.js:219-237` |
| 4 | Login throttling: 5 failures / 15 min per email and per IP, DB-backed, fail-closed (503 if the limiter store is down). Same error for unknown email, wrong password and inactive account. | [V] `auth/login/route.js` |
| 5 | Session store: `refresh_tokens` (hashed). Reset store: `password_reset_tokens`. Last sign-in: `account_last_login` (written at login). | [V] `entities/index.js`, `me.js` |
| 6 | **No Next.js middleware/proxy anywhere.** Page protection is client-side: `AppShell` calls `refreshSession()`, then `redirectToLogin()`; role page guard `isRoleAllowed` is "a UI safeguard only". Real enforcement is on the servers. | [V] no `middleware.js`/`proxy.js` under `apps/*/src`; `AppShell.js:112-168`; `guards.js` |
| 7 | Frontend never talks to services directly. `next.config.js` rewrites `/api/:path*` to the gateway. Auth to the gateway is a **Bearer header, not cookies**. | [V] `next.config.js`, `session.js:apiFetch` |
| 8 | All API calls go through **one funnel**, `apiFetch` and `getAccessToken` in `session.js`; 41 frontend files import from it. | [V] grep: 195 uses across 41 files |
| 9 | Gateway checks only "valid token". No role or office logic. Per-route public list: complaints, queue public, ratings, health, auth. | [V] `routes.js`, `gateway.js` |
| 10 | Each service enforces `requirePermission(roles, officeScope)`: Executive read-only; Office Head/Staff limited to own office; Office Staff transaction access by `started_by === user.id`. | [V] `shared/permissions.js`, `operations/.../access.js` |
| 11 | Machine-to-machine paths are independent of user auth: FMS pull uses `ccms_mk_<ref>.<secret>` machine keys validated by Core; services use `x-service-key`. | [V] `routes.js:55-68`, `core-service/src/lib/machine-keys.js`, `service-key.js` |
| 12 | `accounts` columns: `account_id uuid PK, employee_no (unique), full_name, email (unique on lower(email)), password_hash, role_key (CHECK 4 roles), office_id (CHECK office rule), position, is_active`. Accounts are deactivated, never deleted. `office_id` is a plain UUID owned by Core (no cross-DB FK). | [V] `entities/index.js:7-37`, baseline SQL |
| 13 | `account_id` is stored in other databases as a plain value (`started_by`, notification, complaint handling, report owner, audit actor, etc.). It is **not** a Clerk-friendly ID. | [V] grep: ~170 hits in 59 files, e.g. `operations-service/.../start.js`, `oversight-service/.../reports.js` |
| 14 | Account create is Super-Admin-only, with an initial **password set by the admin**; reset is an emailed single-use link (60 min). First Super Admin comes from `bootstrap:admin`. | [V] `accounts.js:155-185, 273-345`, `bootstrap.js` |
| 15 | Security-relevant events audited: `ACCOUNT_CREATED/UPDATED/DEACTIVATED/REACTIVATED`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET`, `PASSWORD_CHANGED`. Sign-in and sign-out are deliberately **not** audited. | [V] `accounts.js`, `me.js`, `auth-service.js:31-35` |
| 16 | No Clerk code exists. The only "clerk" hits are unrelated words (e.g. machine-key docs, seed text, tests). | [V] repo-wide case-insensitive grep |
| 17 | Multi-project Vercel deployment: frontend, gateway, identity, core, operations, oversight are separate projects. | [V] `next.config.js` comment, per-app `vercel.json`/READMEs |

### 2.3 Not inspected
I did not open `apps/frontend/src/app/layout.js` in detail, the `accounts/page.js` internals, `mailer.js`, or the production Vercel/Neon/Clerk dashboards. Production account count, the production domain name, and the current Clerk dashboard configuration are **unknown** to me [A].

---

## 3. Current Authentication Dependencies (every file that depends on it)

### 3.1 Authentication core (will be replaced or retired)
| File | Role | Fate |
|---|---|---|
| `identity-service/src/app/api/auth/{login,logout,refresh,jwks}/route.js`, `auth/password-reset/confirm/route.js` | Auth endpoints | Keep during dual run; retire at cleanup |
| `identity-service/src/lib/{auth-service,tokens,passwords,cookies}.js` | Session/JWT/password logic | Retire at cleanup |
| `identity-service/src/app/api/me/password/route.js`, `lib/me.js` (`changeOwnPassword`, `recordLogin`) | Own password change; last sign-in | Retire password part; replace `recordLogin` |
| `identity-service/src/app/api/accounts/[id]/reset-password/route.js`, `accounts.js` (`requestPasswordReset`, `completePasswordReset`), `mailer.js` | Admin reset flow | Replace with Clerk-driven flow |
| `identity-service/scripts/generate-jwt-key.js`, `JWT_PRIVATE_KEY` | Signing key | Retire at cleanup |
| DB tables `refresh_tokens`, `password_reset_tokens`, columns `accounts.password_hash` | Credential storage | Keep untouched until rollback window ends |
| `frontend/src/lib/auth/session.js`, `sign-out-flow.js`, `useSignOut.js`, marker cookie `ccms_signed_in` | Browser session | Re-implement behind same exports |
| `frontend/src/app/login/page.js`, `reset-password/page.js` | UI | Replace with Clerk components |

### 3.2 Token verification (must change to accept Clerk tokens)
| File | Why |
|---|---|
| `packages/ccms-shared/src/auth.js` | `createTokenVerifier`, `claimsToUser`, `getDefaultVerifier` (hard-wired to `IDENTITY_JWKS_URL`, issuer `ccms-identity`, aud `ccms`) |
| `apps/api-gateway/src/lib/auth.js`, `instance.js` | Separate copy of the verifier (duplicated logic, TOKEN_PROBLEM_CODES list) |
| `identity-service/src/lib/guard.js` | Verifies against Identity's own local keys |
| `core-service/src/lib/calendar/engine-auth.js` | Calls shared `authenticate` |
| `packages/ccms-shared/src/testing/index.js` and ~15 test helpers | Mint Identity-style RS256 tokens. Must keep working (legacy path stays) |

### 3.3 Consumers that need **no** change if `user.id` stays the CCMS `account_id` [R]
All `requirePermission(...)` routes in Core, Operations and Oversight; `requireSwitchForStaff` (keys on `user.role`); `canAccessTransaction` (`started_by === user.id`); notifications, complaints handling, reports owner, KPIs. This is the main reason to keep `account_id` as the principal rather than Clerk's `user_…` ID.

### 3.4 Frontend consumers of `session.js` (41 files)
They import `apiFetch`, `getAccessToken`, `currentUser`, `refreshSession`, `redirectToLogin`, `signOut`. If `session.js` keeps these exports, **none of the 41 pages/components need editing** [R].

---

## 4. Recommended Clerk Architecture

### 4.1 Principle [R]
> Clerk = identity (who). CCMS `accounts` = authorization (what). Clerk's session token carries a *copy* of role/office; the CCMS DB remains the source of truth and is pushed to Clerk on every account change.

### 4.2 Components
```
Browser
  ClerkProvider (frontend layout) -> <SignIn/> -> Clerk session
  session.js (re-implemented): getAccessToken() = await clerk.session.getToken()   // short-lived JWT, auto-refreshed by Clerk
  apiFetch -> Authorization: Bearer <Clerk JWT>  (unchanged call shape)
Gateway tokenCheck  : verify via Clerk JWKS (iss = Clerk Frontend API URL, azp = allowed origins) OR legacy Identity JWKS (dual period)
Services authenticate(): same dual verifier; claimsToUser maps  account_id->id, role, office_id, employee_no, full_name
Identity service (kept, shrunk): accounts directory, switches, audit, internal routes
   + on create/update/(de)activate -> call Clerk Backend API to set publicMetadata / ban / revoke sessions
```

### 4.3 Token claims [R] (needs dashboard step [A])
Clerk "Customize session token" claims, built from `public_metadata`:
```json
{ "account_id": "{{user.public_metadata.account_id}}",
  "role": "{{user.public_metadata.role}}",
  "office_id": "{{user.public_metadata.office_id}}",
  "employee_no": "{{user.public_metadata.employee_no}}",
  "full_name": "{{user.public_metadata.full_name}}" }
```
- Keep it small; Clerk limits cookie size [A: verify current limit in Clerk docs].
- Only the CCMS server (Backend API) may write `public_metadata`. Never use `unsafe_metadata` for authorization [R].

### 4.4 Why this beats the alternative [R]
| Option | Pro | Con |
|---|---|---|
| **A. Claims in Clerk token (recommended)** | Preserves today's property that services verify offline and keep working if Identity is down (the design intent in `session.js` header, "RBAC doc 3.5"). Smallest code change in `claimsToUser`. | Needs metadata sync; role changes propagate within Clerk's token lifetime (≈60 s [A]). This is *better* than today's 15 min. |
| B. Token has only Clerk `sub`; each request looks up the account in Identity | Always fresh | Every request depends on Identity; adds latency; changes the failure model. Only the CC056 switches do this today, with a 10 s cache and deny-all on failure [V `switches.js`]. |

### 4.5 Do we need webhooks? [R]
**Not for the first release.** Linking is done server-side by CCMS (it knows the Clerk user ID when it creates or finds the user), and CCMS pushes metadata to Clerk. Webhooks become useful only for: (a) `user.deleted` / `user.updated` hygiene, (b) `session.created` to maintain `account_last_login`. If added later, verify the Svix signature and make handlers idempotent. Alternatively update last sign-in from `/api/me` [R].

### 4.6 What stays (Identity "accounts service") [R]
`accounts` CRUD, roles/office validation against Core, `permission_switches`, audit, outbox, `/internal/*` routes, `/me` (read part), `rate_limit_hits` (still used by complaints/ratings/queue limiters elsewhere [V `shared/rate-limit.js`]), bootstrap of first Super Admin (changed, see 5.5).

---

## 5. Existing User Compatibility

### 5.1 Matching key
- `accounts.email` is unique case-insensitively [V `accounts_email_lower_uq`]. **Link by verified primary email** and then store the Clerk ID.
- Add `accounts.clerk_user_id text NULL UNIQUE` [R] (new migration; additive; `typeorm_migrations`-tracked per `docs/database-migrations.md`). The existing `account_id` UUID does **not** change.
- Rule: a Clerk user is accepted by CCMS only if the token's `account_id` metadata equals an *active* account whose `clerk_user_id` equals the token `sub`. This double binding prevents metadata spoofing or reuse [R].

### 5.2 No duplicate accounts
CCMS already forbids duplicate email/employee number [V `assertUnique`]. Clerk is configured so **sign-up is disabled** (invitation / admin-created only) [R][A: dashboard setting]. Therefore Clerk cannot create a user CCMS does not know about, and a Clerk user with no `account_id` metadata gets a 401 from CCMS [R].

### 5.3 How each existing user moves [R]
Run an **admin-initiated linking job**, dry-run first, per account:
1. Find Clerk user by email (Backend API).
2. Found: verify email is verified, set `public_metadata`, store `clerk_user_id`.
3. Not found: create the Clerk user (or an invitation) with the same email and metadata; store the ID.
4. The user then signs in with Clerk (email code or "set a password") the first time.
5. Report: linked / created / skipped / conflicts. Make the job idempotent and resumable. Reuse the existing `audit_outbox` + `/api/jobs/outbox` pattern for retries [V exists].

**Open point [A]:** whether users created through the Clerk Backend API start with a *verified* email, and whether invitation `public_metadata` is copied onto the new user. Confirm both in the Clerk docs before choosing create-vs-invite.

### 5.4 Passwords [A]
- CCMS hashes are a custom Node-`scrypt` format (`scrypt$salt$hash`, default cost). Clerk's user import supports a fixed list of hashers [A: confirm]; I do not expect this exact format to be on it.
- **Do not plan on migrating hashes.** Plan on first-sign-in credential setup via Clerk. This also means the old hashes stay unused in the DB until cleanup.
- Hard rule from your brief: **do not reset or touch existing passwords**. The legacy login keeps working untouched during the dual period, so nobody is forced to change anything on day one.

### 5.5 First Super Admin / lockout protection [R]
The system must never end up with zero Super Admins who can sign in. Before cutover, link and prove sign-in for **at least two** Super Admins in Clerk. Keep `bootstrap:admin` (legacy path) until cleanup as the break-glass route.

### 5.6 Office assignments, position, employee number, switches
All remain in CCMS and are unaffected [V]. Only `role`, `office_id`, `employee_no`, `full_name` are mirrored into Clerk metadata for the token.

---

## 6. Role and Permission Compatibility

| Concern | Today | With Clerk [R] |
|---|---|---|
| 4 roles, `ROLE_LIST` validation | `claimsToUser` rejects unknown role | Same check on the mapped claim. Unknown or missing role => 401 |
| Super Admin | campus-wide R/W | unchanged (server-side) |
| Executive read-only | `requirePermission` blocks non-GET | unchanged |
| Office Head/Staff scoping | `officeScope='office'`, `assertOfficeAccess` | unchanged; `office_id` claim must stay a string UUID or null |
| Staff switches (CC056) | Identity internal route, service key | unchanged |
| Module access | per-route role lists, UI `isRoleAllowed` | unchanged |
| Deactivation | `is_active=false` + revoke refresh tokens | Identity also **bans / revokes sessions in Clerk** (Backend API). Tokens already issued expire in ≈60 s [A], faster than today's 15 min |
| Last Super Admin protection | DB lock + check | unchanged |
| Account audit | `ACCOUNT_*` | unchanged, plus new `ACCOUNT_LINKED_CLERK` event [R] |

**Gap to decide:** `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET` and `PASSWORD_CHANGED` audit events [V] disappear because Clerk performs those actions. Either accept that (Clerk's own logs hold them) or record Clerk-side events through webhooks. This is a compliance decision, not a technical one.

---

## 7. Required Environment Variables

All names are [A] until checked against the installed `@clerk/nextjs` docs. Values are **not** to be set by this task.
> **Superseded by Section 15.5**, which gives the final names per environment and per service (the CCMS-owned verification variables use a `CCMS_` prefix there).

**Frontend (`apps/frontend`)**
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY` (server only; only needed if the frontend uses server helpers or middleware)
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login` (keep the current route)
- `NEXT_PUBLIC_AUTH_PROVIDER=legacy|dual|clerk` [R] feature flag (build-time)

**Gateway, Core, Operations, Oversight, Identity (verification)**
- `CLERK_ISSUER` = the Clerk Frontend API URL (JWT `iss`)
- `CLERK_JWKS_URL` = `<issuer>/.well-known/jwks.json`
- `CLERK_AUTHORIZED_PARTIES` = comma list of allowed web origins (checked against `azp`)
- `AUTH_ACCEPT=legacy,clerk` [R] verification switch (replaces nothing; existing `IDENTITY_JWKS_URL`, `JWT_ISSUER`, `JWT_AUDIENCE` stay for the legacy path)

**Identity only (Backend API sync)**
- `CLERK_SECRET_KEY` (never to the browser, never in `NEXT_PUBLIC_*`)
- `CLERK_WEBHOOK_SIGNING_SECRET` only if webhooks are added later

**Existing, unchanged:** `SERVICE_KEY`, `CRON_SECRET`, `DATABASE_URL`, `DATABASE_ADMIN_URL`, `DB_TARGET`, `API_GATEWAY_URL`, machine-key config.
**Retired at cleanup:** `JWT_PRIVATE_KEY`, `JWT_KEY_ID`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `PASSWORD_RESET_TTL_MINUTES`, SMTP reset settings.

Repo hygiene: new variables belong in the per-app `.env.example`, `scripts/init-env.mjs`, and `scripts/qa/manage.mjs` (QA generation) [V those files reference the current JWT vars].

---

## 8. Security Considerations

1. **Account takeover by email claim.** Match only on a *verified* Clerk email; disable public sign-up; consider requiring verified email domain allowlist (`@pup.edu.ph` appears in Identity README [V]).
2. **Authorization from metadata.** Only server-set `public_metadata` (never `unsafe_metadata`) feeds the token. Reject tokens lacking `account_id`, `role`, or with `role` outside `ROLE_LIST`.
3. **Token validation.** Verify signature, `iss`, expiry, and **`azp`** (authorized parties) to stop tokens minted for other apps. Keep RS256-only. Do not accept `alg: none` or HS tokens. Current verifier already pins `algorithms: ['RS256']` [V]; Clerk uses RS256 [A].
4. **Dual-verify risk.** Two accepted issuers double the attack surface. Keep the window short and accept each issuer only with its own JWKS and audience. A token from one issuer must never be validated with the other's keys.
5. **No cookie auth added.** API stays Bearer-based, so adding Clerk's `__session` cookie does not create new CSRF exposure on the gateway [V: gateway reads only the `Authorization` header].
6. **Public endpoints.** Complaints, queue public, ratings and health remain unauthenticated and rate-limited [V]. Do not put them behind Clerk middleware; the matcher must exclude `/api/*` or the middleware must mark them public, or the citizen flows break [R].
7. **Machine keys and service key** are independent of Clerk and must remain untouched [V].
8. **Rate limiting.** Login throttling moves to Clerk. The shared DB limiter stays for the public endpoints [V].
9. **Secrets.** `CLERK_SECRET_KEY` only on Identity (and frontend server if needed), as Vercel secrets. No secret in git or `NEXT_PUBLIC_`.
10. **Revocation.** Deactivation must call Clerk (ban + revoke sessions) *and* flip `is_active`. If the Clerk call fails, the outbox retries; meanwhile the 60 s token life bounds exposure [R][A].
11. **Break-glass.** Keep two Super Admins and the legacy path until cleanup (5.5).
12. **Dependency risk.** Clerk becomes an availability dependency for sign-in; with claims-in-token, already signed-in users keep working through a Clerk blip until their short token expires [R].

---

## 9. Production Migration Strategy

### 9.1 Can it be staging-first? **Yes, with one constraint.**
- The repo already has isolated QA tooling (`compose.qa.yml`, `scripts/qa/*`, `docs/qa-environment.md`) and a proven Neon-branch rehearsal process [V `docs/evidence/tt1-hosted-rehearsal-20261110.md`, `docs/database-migrations.md`].
- **Constraint [A]:** a Clerk *production* instance is tied to the production domain and holds the real user pool. Staging should use a Clerk **development** instance (different keys, different user pool). Staging therefore tests the *code and claims mapping*, not the real production Clerk configuration. A final, low-blast-radius smoke test on production (Section 10, Phase 4) is unavoidable.

### 9.2 Phases (all gated by explicit approval)
| Phase | What | Production impact |
|---|---|---|
| 0 | Confirm unknowns in Section 12 (domain, Clerk plan, account count, Clerk-side settings) | none |
| 1 | Build behind flags on a branch. Add `clerk_user_id` migration, dual verifier, `session.js` Clerk implementation, Identity sync. Default `AUTH_PROVIDER=legacy`, `AUTH_ACCEPT=legacy` => **behavior identical to today** | none |
| 2 | Deploy to staging with Clerk **dev** instance on a Neon branch copy; run full test list (Section 11) | none |
| 3 | Production deploy of the code with flags still `legacy`; run the additive migration (rehearsed first, `--confirm=<db>`) | additive column only |
| 4 | Link accounts (dry run, then real) in production Clerk; verify two Super Admins can sign in via Clerk; set `AUTH_ACCEPT=legacy,clerk` | none: legacy still works |
| 5 | Pilot: switch `NEXT_PUBLIC_AUTH_PROVIDER=dual` (users may use either) or a small group | low |
| 6 | Cutover: `clerk` only in the UI; services keep `legacy,clerk` for one more window | existing 7-day refresh cookies naturally expire; no forced logout |
| 7 | Cleanup (separate approval): stop accepting legacy tokens, retire auth routes/tables | irreversible; only after a stability period |

### 9.3 Existing sessions
Legacy access tokens (15 min) and refresh cookies (7 days) stay valid through Phases 1-6 because the legacy verifier is never removed before Phase 7 [R]. No one is forcibly signed out.

---

## 10. Required File Changes

### 10.1 Create
| File | Purpose / impact |
|---|---|
| `apps/identity-service/migrations/<ts>-ClerkUserLink.js` (+ schema json, register in `migrations/index.js`) | Adds nullable unique `accounts.clerk_user_id`. Additive, append-only per `docs/database-migrations.md`. Must also be added to `scripts/migrations.test.mjs` revert lists (they enumerate migrations [V]). |
| `packages/ccms-shared/src/clerk-auth.js` | Clerk verifier (iss, azp, JWKS), claim mapper, composite `legacy+clerk` verifier. Pure, unit-testable. |
| `apps/identity-service/src/lib/clerk-sync.js` | Backend API client: create/find user, set `public_metadata`, ban/unban, revoke sessions. Uses the outbox for retries. |
| `apps/identity-service/scripts/link-clerk-users.js` | The dry-run-first linking job (5.3). |
| `apps/frontend/src/proxy.js` (Next 16 name for middleware [A: verify in `node_modules/next/dist/docs/`]) | Optional server-side gate for page routes only; **must exclude `/api/*` and public citizen pages**. Because page protection today is purely client-side [V], this is a *new* capability, not a replacement. It can be deferred. |
| Tests for each of the above | See Section 11. |

### 10.2 Modify
| File | Change | Impact |
|---|---|---|
| `packages/ccms-shared/src/auth.js` | `getDefaultVerifier` returns composite verifier per `AUTH_ACCEPT`; `claimsToUser` accepts Clerk claim shape (`account_id`→`id`) | Core of the change; affects every service. Legacy path unchanged |
| `apps/api-gateway/src/lib/auth.js`, `instance.js` | Same dual verification for `createTokenCheck` | Gateway rejects/accepts tokens; must keep `TOKEN_PROBLEM_CODES` 401 vs 503 split |
| `apps/identity-service/src/lib/guard.js` | Use composite verifier (Identity must accept Clerk tokens for `/me`, `/accounts`, switches) | Identity admin screens keep working |
| `apps/identity-service/src/lib/accounts.js` | On create/update/(de)activate call `clerk-sync`; creation no longer requires an admin-set password when `AUTH_PROVIDER=clerk`; `reset-password` becomes "send Clerk sign-in link" | Changes Super Admin workflow and audit events |
| `apps/identity-service/src/lib/me.js` | `recordLogin` replaced by update-on-`/me` (or webhook); `changeOwnPassword` hidden in clerk mode | "Last sign-in" display preserved |
| `apps/identity-service/src/lib/bootstrap.js` | Optionally link the bootstrap admin to Clerk | Keep legacy path as break-glass |
| `apps/frontend/src/lib/auth/session.js` | Re-implement `signIn/refreshSession/getAccessToken/signOut/revokeServerSession/currentUser` over Clerk, same exports, same `ApiError` shape | 41 consumer files unchanged |
| `apps/frontend/src/app/layout.js` | Wrap in `ClerkProvider` (file not inspected in detail [A]) | App-wide |
| `apps/frontend/src/app/login/page.js` | Render `<SignIn/>` (keep `/login` URL, keep `ROLE_NOT_RECOGNIZED` messaging) | UX change |
| `apps/frontend/src/app/reset-password/page.js` | Remove/redirect in clerk mode | Old emailed links break only after cleanup |
| `apps/frontend/src/app/accounts/page.js` (line ~200 reset call), `components/account/ChangePasswordForm.js` | Replace reset/change with Clerk-driven actions or Clerk `UserProfile` | Admin and self-service UX |
| `apps/frontend/src/components/layout/AppShell.js` | Likely unchanged (uses `session.js`); verify `useSignOut` | Low |
| `.env.example` files, `scripts/init-env.mjs`, `scripts/qa/manage.mjs`, `packages/ccms-shared/src/qa.js` | New variables; QA must mock or use a Clerk dev instance | Dev/QA ergonomics |
| `packages/ccms-shared/src/testing/index.js` | Helper to mint Clerk-shaped test JWTs with a local JWKS | Keeps ~15 test suites meaningful |
| `docs/*` and READMEs | Document the new flow | Docs |

### 10.3 Must remain
`accounts` table and all columns; `account_id` as the principal; roles/permissions modules in `ccms-shared`; `requirePermission`, office scoping, Executive read-only; switches (CC056); Identity internal routes and service key; machine keys; public citizen endpoints and their rate limiters; the audit pipeline; legacy login endpoints until Phase 7.

### 10.4 Removable only at Phase 7 (not before)
`auth/login|logout|refresh|jwks|password-reset` routes, `tokens.js`, `passwords.js`, `cookies.js`, `generate-jwt-key.js`, `refresh_tokens` and `password_reset_tokens` tables, `accounts.password_hash` (drop via a *new* migration, never edit old ones), login-page legacy code, marker cookie logic, legacy env vars.

---

## 11. Testing Checklist

**Unit (no network)**
- Clerk verifier: valid token; wrong `iss`; wrong `azp`; expired; `alg` other than RS256; missing `account_id`; unknown role; role/office combination violating the office rule; JWKS unreachable => 503 not 401 (matches current behavior [V]).
- Composite verifier: legacy token accepted in `legacy,clerk`; Clerk token rejected when `AUTH_ACCEPT=legacy`; cross-issuer key confusion rejected.
- `claimsToUser` mapping keeps `user.id === account_id`.
- `clerk-sync`: metadata payload exactly the 5 fields; failure => outbox retry; deactivate => ban + revoke.
- `session.js` contract tests: existing `session.test.js` must pass unchanged in `legacy` mode; new tests for `clerk` mode.

**Integration (disposable Postgres, `TEST_PG_URL`)**
- Migration up/down, `migrate:check-baseline`, revert-list tests (`scripts/migrations.test.mjs`).
- Linking job: dry run changes nothing; idempotent; handles existing Clerk user, missing user, duplicate email, unverified email, inactive account.
- Each role end-to-end: Super Admin, Office Head, Office Staff, Executive. Office isolation (Staff A cannot read Office B), Executive write => 403, Staff `started_by` ownership, switches OFF/ON.
- Deactivate a user: Clerk session ends; CCMS 401 within the bound.
- Public endpoints still work with no token: complaint, complaint status, queue ticket, now-serving, rating.
- FMS machine-key pull and service-key routes unaffected.

**Staging (Clerk development instance, Neon branch)**
- Real sign-in/out, multi-tab sign-out, token refresh over >1 hour, role change propagation time, Clerk outage simulation, legacy login still works in `dual`.

**Production smoke (Phase 4/5)**
- Two Super Admins sign in via Clerk; one Office Staff pilot; legacy login of a different user still works.

Existing baseline to keep green: 172 test files today, plus `npm run ci` (lint, check:time, test, build, `npm audit --omit=dev`) [V `ci.yml`].

---

## 12. Open Questions (must be answered before building)

1. What is the production domain, and is the Clerk production instance already verified (DNS CNAMEs) for it? [A]
2. How many active production accounts exist, and how many have unique, valid, mailbox-accessible emails? Are any shared mailboxes used? (I did not and must not query production.)
3. Which Clerk plan and which sign-in methods are enabled (email code, password, SSO)? Is sign-up currently open? [A]
4. Do users have to keep passwords, or is email-code sign-in acceptable? (Drives 5.4.)
5. Compliance: is the loss of `PASSWORD_*` events in the CCMS audit trail acceptable (Section 6)?
6. Is a Clerk development instance available for staging, or only the production instance?
7. Exact `@clerk/nextjs` version compatible with Next.js 16.4.5 and React 19.3.0 (versions are pinned in `package.json`) [A: check Clerk's compatibility notes first].
8. Should the Identity service remain a separately deployed Vercel project? (I recommend yes; it keeps accounts, switches and audit.)

---

## 13. Rollback Plan

| Situation | Action | Data impact |
|---|---|---|
| Problem found in Phases 1-3 | Do not enable flags. Revert the deploy. | none (only an unused nullable column exists) |
| Phase 4/5: Clerk sign-in problems | Set `NEXT_PUBLIC_AUTH_PROVIDER=legacy` and `AUTH_ACCEPT=legacy`. Everyone signs in the old way. | none; password hashes were never touched |
| Wrong role/office in tokens | Re-run the sync job from CCMS (source of truth); or set `AUTH_ACCEPT=legacy`. | Clerk metadata overwritten from CCMS |
| Clerk outage | Flip to `legacy` (needs users to know their old password, so keep this path until Phase 7) | none |
| Bad migration | `npm run migrate:revert` for the single additive migration (rehearsed) | column dropped; no business data lost |
| After Phase 7 cleanup | **Not reversible by flag.** Restore from backup. This is why Phase 7 needs its own approval and a stability window. | — |

Lockout safety: never disable the legacy path while fewer than two Super Admins have been proven to sign in through Clerk.

---

## 14. Risks and Recommendations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Passwords cannot migrate; every user must do a first-time Clerk setup | High | Invitation emails, pilot group, keep legacy login in `dual` period, helpdesk plan |
| 2 | Account takeover via unverified/duplicate email | High | Verified email only, sign-up disabled, optional domain allowlist |
| 3 | Role drift between CCMS and Clerk metadata | Medium | Single writer (Identity), outbox retries, periodic reconciliation job, tokens carry `account_id` that is re-checked against `clerk_user_id` |
| 4 | Staging cannot fully mirror production Clerk | Medium | Dev-instance staging plus a controlled production smoke test |
| 5 | Public citizen endpoints accidentally protected by Clerk middleware | Medium | Matcher excludes `/api/*` and public pages; regression tests for the 5 public flows |
| 6 | Loss of password audit events | Medium | Decide explicitly (Section 6, Q5) |
| 7 | Duplicated verifier code (gateway vs shared) diverges | Medium | Put the Clerk logic once in `ccms-shared` and import it in the gateway (the gateway already depends on `ccms-shared`) |
| 8 | Clerk becomes a sign-in dependency | Low-Med | Claims-in-token keeps signed-in users working briefly; keep legacy fallback until Phase 7 |
| 9 | Test suites depend on the self-minted Identity token | Low | Keep legacy path and add Clerk-shaped test helper |
| 10 | Next.js 16 "not the Next.js you know" (per `AGENTS.md`): middleware/proxy and Clerk helpers may differ from common docs | Medium | Read `node_modules/next/dist/docs/` before writing `proxy.js`; pin and test the Clerk SDK on this exact Next version |

### Final recommendation
Adopt **Clerk for authentication only**, keep **CCMS `accounts` as the authorization source**, carry **`account_id` + role + office in a customized Clerk session token**, run a **dual-verify period** behind flags, link users by **verified email** with a dry-run job, and treat **cleanup of the legacy auth** as a separate, later, explicitly approved step. Begin only after the open questions in Section 12 are answered.

---

## 15. Clerk Provider Configuration Assessment

*Added 2026-11-13. Analysis only. No configuration value is reproduced in this report.*
> **Read together with Section 16**, which checks this section against the official Clerk documentation and corrects 15.4.3 (key rotation), 15.5 (variable names) and 4.3 (claim source).

### 15.1 Status of the supplied configuration

| Item received (by name) | Value available to this analysis? | Validation result |
|---|---|---|
| Frontend API URL | Dev: yes · Prod: no | Dev **PASS** · Prod PENDING |
| Backend API URL | Dev: yes · Prod: no | Dev **PASS** · Prod PENDING |
| JWKS URL | Dev: yes · Prod: no | Dev **PASS** · Prod PENDING |
| JWKS Public Key (PEM) | Dev: yes · Prod: no | Dev **PASS** (matches live JWKS) · Prod PENDING |
| Publishable Key | Dev: yes · Prod: no | Dev **PASS** (`pk_test_`, same instance) · Prod PENDING |
| **Secret Key** | **Not in the list** | **MISSING** (needed by Identity for the Backend API; see 15.6) |

**Update 2026-11-13: development instance values received and validated.**
- The provider supplied the five values for the **development** instance of "PUP QC AAIP" (Section 17). The checker in 15.2.3 ran with the live JWKS fetch.
- Results: **12/12 PASS, 0 FAIL, 0 WARN.**
  - C1: `pk_test_` (development).
  - C2: the publishable key decodes to the Frontend API host, so it is the same instance.
  - C3: `*.clerk.accounts.dev` (development domain, as expected).
  - C4: Backend API is `api.clerk.com` (this does not identify the instance).
  - C5: JWKS URL = `<Frontend API>/.well-known/jwks.json`.
  - C6: the provided PEM equals the single key currently published in the live JWKS (RSA 2048).
  - C7: `alg` RS256.
- A Node.js libuv assertion on Windows appeared at process exit, after the result line; it is not a validation result.
- The input file was deleted after the run.
- **Still pending:**
  - C8 (a real session token: confirm no `aud`, check `azp` and the `ccms` claim);
  - the **development Secret Key** (not supplied, correctly; to be placed straight into the Identity project's secrets);
  - all **production** instance values (requested later, Section 17.3).
- The values are public by Clerk's design but are still not reproduced here; they belong in environment configuration.

*Original note:* the request listed the five item *names* only. A search of the working directory (excluding `node_modules`, `.next`, lockfile) found no Clerk key, Clerk host, or `CLERK_*` variable anywhere except this report. **No value has been validated yet.** Everything in 15.2 is the procedure and the pass criteria. Run it with the checker in 15.2.3 and record only PASS/FAIL here.

### 15.2 Configuration validation procedure

#### 15.2.1 How to tell whether the five values belong to one instance
Clerk facts below are [A] (from Clerk's published conventions, not verifiable from this repo). Confirm against current Clerk docs.

| Check | Pass criterion | Why it proves something |
|---|---|---|
| C1 Publishable key prefix | `pk_live_` = production instance; `pk_test_` = development instance | Identifies the environment |
| C2 Publishable key payload | The part after the prefix is base64 of `<frontend-api-host>$`. The decoded host must **equal** the Frontend API URL host | Strongest "same instance" proof between key and Frontend API |
| C3 Frontend API host type | Production: a custom domain, normally `clerk.<your-domain>`. Development: `<slug>.clerk.accounts.dev`. `pk_live` with `*.clerk.accounts.dev` = inconsistent | Shows whether the production domain is actually configured |
| C4 Backend API URL | `https://api.clerk.com` (path `/v1/...`) | **Does not identify an instance.** It is the same host for every Clerk customer; the **Secret Key** selects the instance. A match here proves nothing about "same instance" |
| C5 JWKS URL | `https://<frontend-api-host>/.well-known/jwks.json` (public, no secret). Alternative `https://api.clerk.com/v1/jwks` needs the Secret Key | Correct verification endpoint for the gateway and services |
| C6 PEM public key vs JWKS | RSA key whose modulus `n` and exponent `e` equal one key in the live JWKS from C5 | Proves the PEM is current and from the same instance. Mismatch = other instance or a rotated key |
| C7 Algorithm | Published keys `kty: RSA`, `alg: RS256` | Matches the existing verifier's `algorithms: ['RS256']` [V `shared/auth.js:53`] |
| C8 Real token (after the dashboard is set up) | Decode one session token in a safe dev tool: `iss` = Frontend API URL, header `kid` present in the JWKS, `azp` = CCMS frontend origin | End-to-end proof |

#### 15.2.2 "Is this the intended production environment?"
It is production only if **all** hold: C1 is `pk_live_`; C3 shows a custom domain; that domain is the real CCMS production domain (still unknown, Section 12 Q1); and the provider confirms DNS for that domain is verified in Clerk. Values that pass C2/C6 but are `pk_test_` are a valid **development/staging** set, not production.

#### 15.2.3 Local checker (does not reveal values)
A read-only script is in the repository: **`scripts/clerk-config-check.mjs`**.

- Input: a JSON file you create **outside the repo** (never commit it) with `frontendApiUrl`, `backendApiUrl`, `jwksUrl`, `jwksPublicKeyPem`, `publishableKey`.
- Run from the repo root: `node scripts/clerk-config-check.mjs <config.json>` (add `--offline` to skip the network).
- Implements C1-C7. Output is PASS/FAIL/WARN/INFO lines only; it never prints the key, the PEM, or key material. The only network call is a GET to the public JWKS URL. It needs no Secret Key.
- [V] Self-tested on a synthetic (fake) development configuration: all checks passed, exit code 0. The fake file was deleted.
- Delete the JSON file after use. Do not commit it.

### 15.3 Compatibility with the existing CCMS architecture

| Layer | Which values it uses | Fit and required change |
|---|---|---|
| **Next.js frontend** (`apps/frontend`) | Publishable Key (public). Frontend API is derived from it by the SDK | Fits. `ClerkProvider` + `<SignIn/>` replace the Identity login. The browser still calls the gateway only through the existing `/api/*` rewrite [V `next.config.js`]. So the token's `azp` will be the **frontend origin**, never the gateway's |
| **Clerk** | All | Must be configured by the provider (custom session-token claims, allowed origins, sign-up disabled); see 15.6 |
| **API Gateway** | JWKS URL, issuer (= Frontend API URL), allowed origins | Fits the existing `createRemoteJWKSet` design [V `gateway auth.js:24-33`]. **Required change:** the gateway currently enforces `audience: 'ccms'` [V `gateway auth.js:37`]; see 15.4 |
| **Identity service** | JWKS (to accept Clerk tokens in `guard.js`) **and Secret Key + Backend API** (to write `public_metadata`, ban users, revoke sessions) | Identity is the **only** CCMS component that needs the Secret Key. It stays as the accounts/authorization service |
| **Core, Operations, Oversight** | JWKS URL, issuer, allowed origins (through `ccms-shared` `authenticate`) | Same change as the gateway, made once in `packages/ccms-shared/src/auth.js`. Route-level RBAC is unchanged |
| **CCMS account database** | none directly | Unchanged except the planned nullable `accounts.clerk_user_id`. `account_id`, role, office, position and switches remain authoritative in CCMS. The Clerk `sub` (`user_…`) is stored as a link and is **never** used as `user.id` |

[V] The FMS machine-key path (`ccms_mk_…`) and `x-service-key` routes do not use user tokens and need none of these values.

### 15.4 JWT verification recommendations

**15.4.1 Blocking incompatibility found in the current verifiers [V].** Both verifiers call `jwtVerify(token, keySet, { issuer, audience, algorithms: ['RS256'] })` with defaults `issuer = 'ccms-identity'`, `audience = 'ccms'` (`packages/ccms-shared/src/auth.js:53`, `apps/api-gateway/src/lib/auth.js:37`). As far as I know, Clerk **session** tokens carry no `aud` claim [A]. Therefore:
- Simply pointing `IDENTITY_JWKS_URL` at Clerk's JWKS would make **every** Clerk token fail (wrong issuer, missing audience).
- A **separate Clerk verifier** with its own issuer and **no audience requirement** is needed. Origin binding is done with `azp` instead (below).
- Alternative [A]: a Clerk **JWT template** can set `aud`, but templates are minted per `getToken({ template })` call and differ from the session token. That adds moving parts; the session token with custom claims is recommended (Section 4.3).

**15.4.2 Required checks for a Clerk token [R]**

| Claim / property | Rule |
|---|---|
| Signature | RS256 only. Key chosen by header `kid` from the Clerk JWKS. Reject `none`, HS*, and unknown `kid` |
| `iss` | Exact match to the configured Frontend API URL (`https://…`, no trailing slash) |
| `aud` | **Not required** for session tokens. Do not accept `aud: 'ccms'` as a substitute. Never reuse the legacy verifier for Clerk tokens or the reverse |
| `azp` | **Required** and must be one of the configured CCMS frontend origins (e.g. production and staging origins, separately per environment) |
| `exp` / `nbf` / `iat` | Enforced. Clock tolerance ≤ 5 s [R]. Clerk session tokens are short-lived (≈60 s) [A] |
| `sub` | Must start with `user_` and equal `accounts.clerk_user_id` for the account in `account_id` (double binding; Section 5.1) |
| Custom claims | `account_id` (UUID), `role` in `ROLE_LIST`, `office_id` (UUID or null) obeying the office rule, `employee_no`, `full_name`. Missing or invalid = 401, same as today's `claimsToUser` [V] |
| `sid` | Present. Optional later use: session revocation checks |

**15.4.3 Why the supplied PEM key alone is not enough [R].**
- A static PEM verifies the signature only. It does nothing for `iss`, `azp`, `exp`, or claims. Those checks above are still required.
- A static PEM breaks when Clerk rotates keys. Every service would reject every user until redeployed.
- Recommended: verify against the **JWKS URL** with caching. The code already does this with `createRemoteJWKSet(... { timeoutDuration: 3000, cooldownDuration: 10_000 })` [V], which refetches when it meets an unknown `kid` (rotation-safe) [A: jose behavior].
- Use the PEM only as (a) a validation artifact (check C6), and optionally (b) a pinned fallback when the JWKS fetch fails. If (b) is used, a JWKS outage must still map to **503 `AUTH_UNAVAILABLE`**, not 401, preserving today's split [V `shared/auth.js:55-61`].

**15.4.4 Token refresh behavior [R]**
- Today: the frontend refreshes a 15-min access token 30 s before expiry and retries once on 401 [V `session.js:13, 317-322`].
- With Clerk: the SDK keeps the session token fresh. `getAccessToken()` becomes `await session.getToken()`. The single 401 retry should request a fresh token (`getToken({ skipCache: true })` [A]) before retrying.
- Role and office changes propagate within the token lifetime (≈60 s [A]) once Identity updates `public_metadata`. Today this takes up to 15 min [V].
- Deactivation: Identity flips `is_active`, then bans the Clerk user and revokes sessions. Exposure is bounded by the token lifetime.

### 15.5 Environment configuration

**Rule:** only the Publishable Key is public. Nothing else gets a `NEXT_PUBLIC_` prefix. Variable names are [A] until checked against the installed `@clerk/nextjs` version. `CCMS_` names are proposals [R].

| Variable | Kind | Frontend | Gateway | Identity | Core / Ops / Oversight |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | public | ✔ | | | |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login` | public | ✔ | | | |
| `NEXT_PUBLIC_AUTH_PROVIDER` (`legacy`/`dual`/`clerk`) | public flag | ✔ | | | |
| `CLERK_SECRET_KEY` | **secret** | only if server helpers/proxy are used | ✘ | ✔ | ✘ |
| `CCMS_CLERK_ISSUER` (= Frontend API URL) | config | | ✔ | ✔ | ✔ |
| `CCMS_CLERK_JWKS_URL` | config | | ✔ | ✔ | ✔ |
| `CCMS_CLERK_AUTHORIZED_PARTIES` (comma list of frontend origins) | config | | ✔ | ✔ | ✔ |
| `CCMS_CLERK_JWT_PUBLIC_KEY` (PEM, optional fallback) | config, not secret but kept server-side | | optional | optional | optional |
| `CCMS_AUTH_ACCEPT` (`legacy`, `legacy,clerk`, `clerk`) | config flag | | ✔ | ✔ | ✔ |
| `CLERK_WEBHOOK_SIGNING_SECRET` | **secret** | | | only if webhooks are added | |

**Per environment [R]**

| Environment | Clerk instance | Keys | Issuer / JWKS | Authorized parties | Flags |
|---|---|---|---|---|---|
| Local | Development (`pk_test_`) | dev keys in each app's `.env.local` (gitignored [V `apps/frontend/.gitignore` exists]) | dev Frontend API | `http://localhost:3000` | `AUTH_PROVIDER=legacy` by default so existing local dev keeps working |
| Staging / QA | Development instance (separate from local if possible) | Vercel **Preview** env secrets | dev Frontend API | staging frontend origin only | `dual` then `clerk` during tests |
| Production | Production (`pk_live_`) | Vercel **Production** env secrets, set only at the approved phase | production Frontend API (`clerk.<domain>`) | production frontend origin(s) only | `legacy` → `legacy,clerk` → … per Section 9.2 |

Never let a staging service accept production tokens or the reverse: issuer and authorized parties must differ per environment.

### 15.6 Information still needed from the provider

| # | Item | Why it blocks |
|---|---|---|
| P1 | The actual values (public items can be shared; or run the checker and send only its output) | Nothing in 15.2 has been validated |
| P2 | **Secret Key**, delivered through a secure channel straight into Vercel secrets (never chat, email or git) | Identity cannot link users or sync roles without it |
| P3 | Confirmation that this is the **production** instance, and the production domain it is bound to | 15.2.2 |
| P4 | DNS status of the Clerk records for that domain (verified or not) | A production instance with unverified DNS will not serve sign-in [A] |
| P5 | A **development** instance and its public values for staging | Section 9.1 |
| P6 | Allowed origins / redirect URLs: production frontend origin, staging origin, `http://localhost:3000`; after-sign-in and after-sign-out URLs (`/login`, role landing pages) | Required for `azp` and SDK redirects |
| P7 | Customized session-token claims (Section 4.3) exactly as specified, and confirmation that only `public_metadata` feeds them | Authorization depends on these claims |
| P8 | Sign-up mode = **disabled / restricted**; enabled sign-in methods (email code, password); email verification required | Account takeover risk (Section 8) |
| P9 | Session settings: token lifetime, inactivity timeout, multi-session policy | Revocation bounds and UX |
| P10 | Webhooks: none needed for the first release (Section 4.5). If added later: endpoint URL, events, signing secret | Optional |
| P11 | Key rotation policy and how the provider announces it | Confirms JWKS (not static PEM) is mandatory |
| P12 | Plan limits relevant to CCMS (monthly active users, Backend API rate limits for the bulk linking job) | Sizing the linking job |

### 15.7 Security concerns specific to this configuration
1. **No secret has been shared, and none should be.** Of the five items, only the Secret Key (not yet supplied) and a future webhook secret are secrets. The Publishable Key, Frontend API URL, JWKS URL and public key are public by design. Still keep them out of reports and logs, per the instruction.
2. **The Backend API URL proves nothing about which instance.** Do not treat a matching `api.clerk.com` as validation.
3. **Development keys in production.** A `pk_test_` key on the production site would put real users into a development instance. Gate production deploys on C1 = `pk_live_`.
4. **Issuer confusion during dual verification.** Keep two independent verifiers (legacy: `ccms-identity`/`ccms`; Clerk: Frontend API/`azp`). Never let one fall back to the other's keys.
5. **Static PEM pinning without JWKS** causes a total outage on rotation (15.4.3).
6. **`azp` omitted** would accept tokens minted for any other app on the same Clerk instance.
7. **Public citizen endpoints** must remain token-free (Section 8 item 6).

### 15.8 Recommended next steps
1. Provide the values, or run the checker yourself and share **only its output**. Record the PASS/FAIL table in 15.1.
2. Obtain P2-P9 from the provider. Keep the Secret Key out of every channel except Vercel secrets.
3. Get a decision on Section 12 questions (production domain, account count, password vs email code, audit gap).
4. Approve the architecture in Sections 4 and 15.4 (separate Clerk verifier; no `aud`; `azp` required; JWKS with cache; `account_id` remains the principal).
5. Only then start Phase 1 (Section 9.2) on a branch, with all flags defaulting to `legacy`.

---

## 16. Technical Validation Against Official Clerk Documentation

*Added 2026-11-13. Sources: official pages on `clerk.com/docs`, read the same day. Analysis only.*

**Tags in this section.**
- **[DOC]** stated in the official Clerk docs (link given).
- **[DOC-absent]** the docs list the item and this thing is not in the list, but they do not explicitly say it is absent.
- **[R]** recommendation.
- **[OPEN]** not settled by the docs; must be tested or asked.

### 16.1 Documentation consulted
| Topic | URL |
|---|---|
| Session token claims, size limits | https://clerk.com/docs/backend-requests/resources/session-tokens |
| Manual JWT verification | https://clerk.com/docs/backend-requests/manual-jwt |
| Custom session token | https://clerk.com/docs/backend-requests/custom-session-token |
| JWT templates | https://clerk.com/docs/backend-requests/jwt-templates |
| `verifyToken()` | https://clerk.com/docs/references/backend/verify-token |
| `authenticateRequest()` | https://clerk.com/docs/references/backend/authenticate-request |
| How Clerk works (token lifetime, refresh, handshake, rotation) | https://clerk.com/docs/guides/how-clerk-works/overview |
| Metadata | https://clerk.com/docs/users/metadata |
| Environment variables | https://clerk.com/docs/deployments/clerk-environment-variables |
| Production deployment | https://clerk.com/docs/deployments/overview |
| Dev vs prod environments | https://clerk.com/docs/guides/development/managing-environments |
| Backend SDK overview | https://clerk.com/docs/references/backend/overview |
| createUser / getUserList | https://clerk.com/docs/references/backend/user/create-user , https://clerk.com/docs/references/backend/user/get-user-list |
| updateUserMetadata / banUser / revokeSession | https://clerk.com/docs/references/backend/user/update-user-metadata , https://clerk.com/docs/references/backend/user/ban-user , https://clerk.com/docs/references/backend/sessions/revoke-session |
| createInvitation | https://clerk.com/docs/references/backend/invitations/create-invitation |
| User migration, password hashers | https://clerk.com/docs/deployments/migrate-overview |
| Sign-up restrictions | https://clerk.com/docs/authentication/configuration/restrictions |
| Webhooks | https://clerk.com/docs/webhooks/overview |
| Rate limits | https://clerk.com/docs/guides/how-clerk-works/system-limits |

### 16.2 Q1: Does a Clerk session token contain `aud` by default?
**No [DOC-absent].**
- The default session-token claims (v2) are `azp, exp, fva, iat, iss, jti, nbf, sid, sub, v, pla, fea, sts`. `o` is added only with an active Organization, and `act` only during impersonation. `aud` is not in this list. Default claims "cannot be overridden by templates" [DOC session-tokens].
- `aud` appears only in **JWT template** examples, as a static value you configure [DOC jwt-templates].
- The docs never state "there is no `aud`" in plain words. **[OPEN]** Confirm on one real token from the instance (C8 in 15.2.1).
- **Consequence [V]:** the current verifiers require `audience: 'ccms'` (`packages/ccms-shared/src/auth.js:53`, `apps/api-gateway/src/lib/auth.js:37`). Clerk session tokens would fail them. Section 15.4.1 stands.

### 16.3 Q2: Can custom claims carry `account_id`, `role`, `office_id`?
**Yes [DOC].**
- **Where to set them:** Dashboard → Sessions → *Customize session token* → Claims editor. They can also be set with `clerk config patch` [DOC custom-session-token].
- **Values:** use shortcodes, which work "in JWT templates and in custom session claims". Dot paths are supported, e.g. `{{user.public_metadata.addresses.Home}}` [DOC jwt-templates]. Add **individual fields** as claims; "not recommended to add the entire `user.public_metadata` object" [DOC metadata].
- **Size:** "up to 1.2KB of custom claims". Going over that limit means the cookie is not set, "which will break your app" [DOC custom-session-token]. The 5 CCMS fields are well under it.
- **Who can write which metadata:**
  - `publicMetadata`: backend writes, frontend reads.
  - `privateMetadata`: backend only.
  - `unsafeMetadata`: the frontend can write it [DOC metadata]. **Never** use `unsafeMetadata` for authorization; a user could change their own role.
- **Freshness:** server-side metadata changes "won't appear in the session token until the next refresh" [DOC metadata], which is at most about 60 s.
- **Better source for `account_id`: Clerk `externalId` [DOC].**
  - `createUser` accepts `externalId`, which "must be unique across your instance" [DOC create-user].
  - `getUserList` can filter by it [DOC get-user-list].
  - The migration guide recommends storing previous IDs as `external_id` and shows the claim `{{user.external_id || user.id}}` [DOC migrate-overview].
  - Putting the CCMS `account_id` in `externalId` gives a **Clerk-enforced one-to-one link**, and it is not a metadata field anyone edits casually.
  - **[OPEN]** Whether `externalId` can be changed after creation (the update path was not confirmed in the pages read).

**Recommended claim set [R]** (supersedes 4.3):
```json
{ "account_id": "{{user.external_id}}",
  "role":       "{{user.public_metadata.role}}",
  "office_id":  "{{user.public_metadata.office_id}}",
  "employee_no":"{{user.public_metadata.employee_no}}",
  "full_name":  "{{user.public_metadata.full_name}}" }
```
**[OPEN]** How a missing `office_id` (Super Admin, Executive) renders: null, an empty string, or the claim left out. `claimsToUser` must treat all three as `null`. Test on a real token.

### 16.4 Q3: What each claim means and how to validate it (`azp` does **not** replace `aud`)

| Claim | Meaning | In Clerk session token? | Validation [R] |
|---|---|---|---|
| `iss` | **Who issued** the token: "the Frontend API URL of the instance" [DOC] | Yes | **Required, exact match** to the instance's Frontend API URL. The manual-verification page does not list it as a step, and `verifyToken` does **not** check it unless `issuer` is passed ("if omitted the issuer is not checked") [DOC verify-token]. We pass it explicitly. This is what separates the production instance, the development instance, and our legacy issuer `ccms-identity` |
| `sub` | **Whom** the token is about: the Clerk user ID [DOC] | Yes | Required. Must equal `accounts.clerk_user_id` of the account named by `account_id` (double binding, 5.1) |
| `aud` | **Which recipient (API) it is meant for** | **No** [DOC-absent] | Cannot be validated on session tokens. Do **not** require it, and do **not** fake it. If an audience-bound token is ever required, use a **JWT template** with `aud` (16.4.1) |
| `azp` | **Which client/origin the token was issued to**: "the Origin header … of the original Frontend API request" [DOC] | Yes (may be missing if the browser sent no Origin) [DOC] | **Required, allowlist of CCMS frontend origins** per environment. Clerk: "highly recommended", and leaving it out "can open your application to CSRF attacks" and the "subdomain cookie leaking attack" [DOC manual-jwt, verify-token]. The docs allow skipping when `azp` is absent. **CCMS should reject instead [R]**: our tokens always come from a browser page on a known origin |
| `exp` | Expiry; session tokens last 60 s [DOC how-clerk-works] | Yes | Required, with ≤ 5 s skew (Clerk default `clockSkewInMs` 5000 [DOC]) |
| `nbf` | Not before; uses the "Allowed Clock Skew" setting [DOC] | Yes | Required, same skew |
| `iat` | Issued at | Yes | Sanity check only (not in the future beyond skew) |
| `sid` | Session ID | Yes | Required to exist. Useful in logs and for later revocation checks |
| `sts` | Session status, e.g. `pending` [DOC] | Yes | Reject `pending` [DOC manual-jwt step 4]. This applies with Organizations; CCMS does not use them, but rejecting costs nothing |
| `v` | Token version (2) | Yes | Reject anything other than 2, so a format change is noticed [R] |
| Header `alg`, `kid` | Algorithm and key ID | Yes | Allow only RS256 (the expected algorithm, per the docs [DOC manual-jwt step 3.1]). Pick the key by `kid`. "Ignore unknown headers", because Clerk may add header fields [DOC] |

#### 16.4.1 Why `azp` is not `aud`, and what we do about the gap
- **`aud` answers "is this token meant for *this API*?"** It stops a token minted for service A from being replayed against service B that trusts the same issuer.
- **`azp` answers "which client application obtained this token?"** In Clerk it is the browser origin. It stops a token minted on another site, or on another subdomain sharing the Clerk instance, from being used here.
- They protect against different things. A token can have the right `azp` and still be replayed to the wrong API.

**Risk assessment for CCMS [R].**
- All CCMS APIs form one trust domain. They sit behind one gateway, and every service already re-checks role and office [V `shared/permissions.js`].
- The real cross-audience risk is **another application on the same Clerk instance**. Those tokens would carry the correct `iss`. They would be stopped by `azp` (a different origin) **and** by the custom-claim binding (no CCMS `account_id` whose `clerk_user_id` equals the token's `sub`).
- Therefore: **do not require `aud` on session tokens**, and **dedicate the Clerk instance to CCMS** (Section 16.11, P13).
- If the security review still requires an audience, use a JWT template with `aud: "ccms-api"`. Its costs [DOC jwt-templates]: no `sid`/`v`/`pla`/`fea` claims, extra latency, and a separate `getToken({ template })` call on every request.

### 16.5 Q4: `verifyToken()` vs `authenticateRequest()` for the gateway

| | `authenticateRequest()` [DOC] | `verifyToken()` [DOC] |
|---|---|---|
| Clerk's guidance | "Recommended"; "fully authenticates a token passed from the request object" | "Lower-level method intended for more advanced use-cases" |
| Input | Whole `Request` (cookie **or** `Authorization` header); handles `handshake` status | A token string |
| Required config | `publishableKey`, **and** `jwtKey` **or** `secretKey` | `jwtKey` (networkless) **or** `secretKey` (network: fetches JWKS from the Backend API) |
| Checks | `authorizedParties`, `audience`, `issuer`, `clockSkewInMs` | same options; `issuer` "not checked" if omitted |
| Extra | `acceptsToken` (`session_token`, `api_key`, `oauth_token`, `m2m_token`) | — |

**How CCMS uses tokens [V].**
- The gateway is a pure API proxy. Browsers reach it only through the frontend's server-side `/api/*` rewrite (`apps/frontend/next.config.js`).
- The gateway reads **only** the `Authorization: Bearer` header (`gateway.js`). It never serves pages.
- Every backend service also receives the same Bearer header from the gateway.

**Recommendation [R].**
- **Gateway and services:** use **`verifyToken()` with `jwtKey`**, inside one shared verifier in `packages/ccms-shared` (the gateway already depends on `ccms-shared`). Always pass `issuer`, `authorizedParties`, and `clockSkewInMs: 5000`. This is networkless, needs **no Secret Key and no Publishable Key**, and keeps today's design where each service verifies offline.
- **Why not `authenticateRequest()` there:** its extra value is cookie and handshake handling for page requests, which the API path never uses. It would require the Publishable Key in every service, and the Secret Key too unless `jwtKey` is set.
- **Frontend (Next.js app):** if a server-side page gate is added later (`clerkMiddleware`/proxy), it uses Clerk's Next.js SDK, which runs `authenticateRequest` internally. That is the right place for it. **[OPEN]** Whether `clerkMiddleware` needs `CLERK_SECRET_KEY` in this setup. Check the `@clerk/nextjs` version you pin.
- **Equivalent alternative:** keep the existing `jose` code with the public JWKS URL `<Frontend API>/.well-known/jwks.json` [DOC manual-jwt], adding the checks in 16.4. This is acceptable and dependency-free, but it means maintaining the claim rules ourselves. Choose one approach, not both.

### 16.6 Q5: JWKS key rotation
What the docs say [DOC]:
- Public key sources: Backend API `https://api.clerk.com/v1/jwks` (Secret Key; no rate limit [DOC system-limits]), Frontend API `/.well-known/jwks.json` (public), or the PEM "JWKS Public Key" from the Dashboard (`jwtKey`).
- `jwksCacheTtlInMs` is deprecated ("a no-op"). `skipJwksCache` forces a fetch on every verification.
- Rotating the signing keys "invalidates all active sessions across your entire user base". Revocation "may be delayed if your application caches the public key" [DOC how-clerk-works].
- **Not found in the docs:** a rotation schedule or a recommended cache TTL.

**Correction to 15.4.3.** Rotation is a **deliberate, instance-wide event that signs everyone out**. It is not a silent background process, so pinning the PEM (`jwtKey`) is reasonable. The real risk is *operational*: six Vercel projects must get the new PEM together.

**Runbook [R].**
1. Rotation is performed only by a CCMS Super Admin together with the provider, inside an announced window.
2. Before rotating, put the new PEM into every service's environment (an accepted-keys list can hold old and new during the window).
3. Rotate, redeploy all services, then remove the old key.
4. Anyone signed in signs in again; this is expected.

Optional safety net: if a `kid` is unknown, fall back to the public JWKS URL, so a missed environment update degrades to a network fetch instead of an outage. A JWKS fetch failure must stay **503**, not 401 [V current behavior].

### 16.7 Q6: Is the Secret Key needed for each server-side operation?

| Operation | Secret Key? | Evidence |
|---|---|---|
| Verify session tokens (gateway, services) | **No**, with `jwtKey` or the public JWKS URL | [DOC verify-token "Networkless if the jwtKey is provided"; manual-jwt] |
| Verify via Backend API JWKS `/v1/jwks` | Yes | [DOC manual-jwt, verify-token] |
| `authenticateRequest()` | No if `jwtKey` is given (needs `publishableKey`) | [DOC "You must provide either jwtKey or secretKey"] |
| `updateUserMetadata` (role/office sync) | **Yes** | [DOC curl uses `Bearer YOUR_SECRET_KEY`] |
| `createUser` (with `externalId`, `publicMetadata`) | **Yes** | [DOC] |
| `createInvitation` | **Yes** | [DOC] |
| `getUserList` by email or `externalId` (linking job) | **Yes** | [DOC BAPI "identified by the Secret Key"] |
| `banUser`, `revokeSession` (deactivation) | **Yes** | [DOC BAPI rule; the pages do not restate it] |
| Verify webhooks (if added) | No; uses `CLERK_WEBHOOK_SIGNING_SECRET` (a different secret) | [DOC webhooks] |
| Frontend `ClerkProvider`, `<SignIn/>`, `getToken()` | No; Publishable Key only | [DOC env vars] |

No documented way to call the Backend API without the Secret Key [DOC-absent].

**Result [R]:** **only the Identity service holds `CLERK_SECRET_KEY`** (plus the frontend, only if `clerkMiddleware` turns out to need it). Gateway, Core, Operations and Oversight get **no** Clerk secret. This narrows the blast radius compared with putting it everywhere.

### 16.8 Q7: Can Identity keep managing accounts without issuing tokens?
**Yes, and the docs support the exact model [DOC].**
- **Sign-up mode "Invite-only" (`restricted`):** users are added "through invitations, enterprise connections or manual user creation" [DOC restrictions]. CCMS (Identity) becomes the only way an account appears in Clerk.
  - **[OPEN]** Which Clerk plan includes this mode. The allowlist/blocklist need a paid plan in production [DOC].
- **`createUser`** can set `externalId` (= CCMS `account_id`), `publicMetadata` (role, office, …), and `skipPasswordRequirement`. Emails created this way "are verified automatically" [DOC create-user]. That settles the 5.3 open point: no unverified-email takeover through this path.
- **`createInvitation`** can carry `publicMetadata`, which "will end up in the user's public metadata" on sign-up [DOC]. It cannot set `externalId` up front, so the link must be written after sign-up. **Prefer `createUser` for CCMS [R].**
- **Passwords:** the CCMS format `scrypt$salt$hash` is **not** among the supported `password_hasher` values. Only `scrypt_firebase` and `scrypt_werkzeug` exist, each with a different format. Clerk: "If you need support for any particular hashing algorithm, contact support" [DOC migrate-overview].
  - Options: (a) users set credentials on first Clerk sign-in, using an email code or reset; or (b) ask Clerk support about importing the hashes.
  - Either way, existing CCMS hashes are not modified [R].
- **Role/office changes:** Identity calls `updateUserMetadata` (a deep merge). The limit is "10 requests per 10 seconds per user" on the metadata endpoint, plenty for admin edits [DOC system-limits].
- **Deactivation:** `banUser`: "all their sessions are revoked and they are not allowed to sign in again" [DOC]. Reactivation calls unban.
- **Bulk linking job sizing [DOC system-limits]:**
  - General Backend API limit: 1000 requests per 10 s (production), 100 per 10 s (development).
  - Invitations: 100 per hour.
  - So the `createUser` path is the faster and safer route. Honour `Retry-After` on 429 responses.
- **Webhooks:** not required. Clerk: delivery is "not guaranteed … immediately or at all", and you "can't rely on the webhook delivery as part of" onboarding [DOC webhooks]. This confirms 4.5. The `session.created` event was not found in the pages read **[OPEN]**, so "last sign-in" should be updated from `/api/me`.

**Identity's responsibilities after cutover [R]:**
- Kept: accounts CRUD, role/office rules, CC056 switches, audit, `/internal/*`, `/me` (read), and a new `clerk-sync`.
- Retired: issuing access/refresh tokens, JWKS publishing, password storage and reset.

### 16.9 Q8: Preserving internal service-to-service authentication
Verified mechanisms, all independent of user sign-in [V]:

| Mechanism | Where | Keep as is? |
|---|---|---|
| `x-service-key` (shared secret, constant-time compare) | `shared/service-key.js`; `/api/internal/*` routes such as `permission-switches`, `office-accounts` | **Yes** |
| Gateway strips `x-service-key` from browser requests and blocks `/api/internal` and `/api/jobs` | `gateway.js`, `routes.js:35` | **Yes** (this is what makes the service key safe) |
| Backend-only routes (`/api/analytics-events`, `/api/transactions/analytics-export`, audit writes) | `routes.js:24-28` | **Yes** |
| `CRON_SECRET` bearer for Vercel Cron `/api/jobs/*` | per-service jobs | **Yes** |
| FMS machine keys `ccms_mk_…`, validated by Core; gateway skips the user-token check only for GET `/api/declarations` | `routes.js:55-68`, `core-service/src/lib/machine-keys.js` | **Yes** |

**Rules for the new verifier [R].**
1. A Bearer value starting with `ccms_mk_` must keep reaching Core untouched. Run the Clerk/legacy check only where the gateway runs it today.
2. Service-key routes must not start accepting Clerk tokens as a substitute, nor the reverse.
3. Clerk offers machine tokens (`acceptsToken: 'm2m_token'`, `machineSecretKey`) [DOC authenticate-request]. **Do not adopt them in this project.** Replacing a working, tested mechanism adds risk with no benefit.
4. Calls that use `CRON_SECRET` or `x-service-key` must keep working while every Clerk flag is off. Cover this in the regression tests (Section 11).

### 16.10 Corrections to earlier sections

| Section | Earlier text | Corrected (by docs) |
|---|---|---|
| 4.3 | `account_id` from `public_metadata` | Prefer `{{user.external_id}}` (Clerk-enforced unique) [DOC]; role/office stay in `public_metadata` |
| 5.3 [A] | Unknown whether backend-created emails are verified | **Verified automatically** by default [DOC create-user] |
| 5.3 [A] | Unknown whether invitation metadata is copied | **Copied** to `public_metadata` on sign-up [DOC]; but invitations cannot set `externalId`, so `createUser` is preferred |
| 5.4 [A] | CCMS hash format probably unsupported | **Confirmed unsupported**; contact Clerk support or use first-sign-in setup [DOC] |
| 9.1 [A] | Production instance bound to the production domain | **Confirmed.** "You will need to have a domain you own" and DNS records. Production keys cannot be used on the host's preview domain; use dev keys on `*.vercel.app` [DOC deployments, managing-environments] |
| 9.1 | Staging on a dev instance | Confirmed. Dev instances "are capped at 100 users", have "a more relaxed security posture", and **dev users cannot be migrated to production** [DOC]. Staging uses test accounts only |
| 15.4.1 | `aud` absent "as far as I know" | Absent from the documented default claims [DOC-absent]; still confirm on a real token |
| 15.4.2 | `azp` required | Confirmed and "highly recommended" [DOC]. CCMS goes further and rejects tokens missing `azp` [R] |
| 15.4.3 | Static PEM "breaks on rotation" | Rotation is a manual, instance-wide event that signs everyone out [DOC]. Pinning `jwtKey` is acceptable with the 16.6 runbook |
| 15.5 | `CCMS_CLERK_JWT_PUBLIC_KEY`, `CCMS_CLERK_AUTHORIZED_PARTIES` | Clerk documents **no** `CLERK_AUTHORIZED_PARTIES` env var; `authorizedParties` is a code option [DOC]. For Next.js the documented networkless key variable is `NEXT_PUBLIC_CLERK_JWT_KEY`; the backend option is `jwtKey` [DOC env vars]. Keep the CCMS-owned names (`CCMS_CLERK_ISSUER`, `CCMS_CLERK_JWT_KEY`, `CCMS_CLERK_AUTHORIZED_PARTIES`) for the gateway and services; they are our own configuration read by our code [R] |
| 15.5 | — | Add `CLERK_ENCRYPTION_KEY` (server-only, Next.js) **only if** `clerkMiddleware` uses dynamic keys [DOC]. Not needed otherwise |

### 16.11 Unresolved questions after the documentation review

| # | Question | How to settle |
|---|---|---|
| O1 | Is `aud` truly absent on our instance's session tokens? | Decode one real dev-instance token (C8) |
| O2 | How a null `office_id` / empty `external_id` renders in custom claims | Real token test with a Super Admin test user |
| O3 | Can `externalId` be updated after creation? | Backend SDK `updateUser` docs or a dev-instance test |
| O4 | Which plan includes Invite-only (`restricted`) mode in production | Provider / Clerk billing page |
| O5 | Does `clerkMiddleware` require `CLERK_SECRET_KEY` with the pinned `@clerk/nextjs`, and is that version compatible with Next 16.4.5 / React 19.3.0? | Clerk Next.js SDK docs + build on a branch |
| O6 | Refresh cadence: docs say both "50-second interval" and "every 60 seconds" | Observe in the browser; no design impact |
| O7 | Is there a `session.created` webhook event? | Dashboard Event Catalog (only needed if last sign-in moves to webhooks) |
| O8 | Will Clerk support import of the CCMS scrypt format? | Ask Clerk support (5.4) |
| P13 | **Is the Clerk instance dedicated to CCMS?** Any other app on the same instance shares `iss` | Provider; required for the 16.4.1 risk assessment |
| — | Items P1-P12 in 15.6 | Still open |

### 16.12 Recommended architecture (final, documentation-checked)

```
Browser ── ClerkProvider (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) ── <SignIn/> (Invite-only instance)
   │  getToken() → 60 s RS256 session token, refreshed by the SDK
   │  Authorization: Bearer <token>   (unchanged apiFetch funnel, session.js)
   ▼
frontend /api/* rewrite ──► API Gateway
   verify (ccms-shared, verifyToken + jwtKey; no secret):
     alg=RS256, kid ∈ accepted keys | iss == CCMS_CLERK_ISSUER | azp ∈ CCMS_CLERK_AUTHORIZED_PARTIES (required)
     exp/nbf ±5 s | v == 2 | sts != pending | account_id, role ∈ ROLE_LIST, office rule
   machine keys (ccms_mk_) and /api/internal, /api/jobs rules unchanged
   ▼
Core / Operations / Oversight / Identity
   same shared verifier → user = { id: account_id, role, officeId, … } → existing requirePermission
Identity (only holder of CLERK_SECRET_KEY)
   accounts CRUD → createUser(externalId=account_id, publicMetadata) / updateUserMetadata / ban / unban
   linking job (dry run first, honours Retry-After) | switches | audit | /internal/* with x-service-key
CCMS DB: accounts unchanged + clerk_user_id; account_id remains the principal everywhere
Legacy Identity tokens: still accepted while CCMS_AUTH_ACCEPT includes legacy (Section 9.2)
```

**Decision points for approval:**
1. `verifyToken` + `jwtKey` in `ccms-shared` (recommended) versus the `jose` + public JWKS URL alternative.
2. No `aud` on session tokens, with a CCMS-dedicated instance (recommended) versus a JWT template with `aud`.
3. `createUser` linking (recommended) versus invitations.
4. First-sign-in credential setup versus asking Clerk support to import the scrypt hashes.

---

## 17. Provider Response (2026-11-13) and Its Impact

### 17.1 What the provider team said
- CCMS will use **their existing Clerk application "PUP QC AAIP"**, which has a **development** and a **production** instance.
- The same application is already used by other PUP QC systems (they configured it for another team).
- Production domain: **`pupqc.tech`**. They need **the CCMS subdomain mapped to our hosted origin**, so they can add the DNS record (as host/subdomain) and add it to the allowed subdomains in Clerk.
- They will provide API keys and credentials on request, and asked us to specify **development or production**.
- They lean toward "option A" (it is not stated which decision this refers to; read as agreement with the recommended options) **[OPEN]**.

### 17.2 This answers P13: the instance is **shared**, not CCMS-only
That changes several recommendations, because these things are **instance-wide** in Clerk [DOC session-tokens, restrictions, create-user]:

| Instance-wide item | Impact on CCMS | Revised recommendation |
|---|---|---|
| **One user pool** | A PUP employee may already have a Clerk user from another system. `createUser` with the same email would conflict | **Linking job must first look up by email** (`getUserList`). Create a user only when none exists. Expect most staff to be existing users later on |
| **`externalId`** (one per user, unique per instance) | Another system may already use it, or want to | **Do not use `externalId`.** Store the CCMS link under a namespace: `public_metadata.ccms = { account_id, role, office_id, employee_no, full_name }`. Supersedes 16.3 / 16.10 row 4.3 |
| **Session-token custom claims** (one config for all apps) | Generic names such as `role` could collide with other teams' claims | One namespaced claim: `"ccms": "{{user.public_metadata.ccms}}"` (or individual `ccms_*` claims). Must fit the shared 1.2KB budget with other teams' claims. **The provider edits the dashboard; we send them the exact claim** |
| **Ban user** | `banUser` blocks the person from **every** PUP system | **Never ban for CCMS deactivation.** Deactivate by setting `is_active=false` in CCMS **and** removing `public_metadata.ccms` (the token loses CCMS claims at the next refresh, ≤60 s, so CCMS answers 401). Optional: revoke only the session. Supersedes 16.8 deactivation |
| **Sign-up mode** (open / invite-only) | Not ours to choose | CCMS cannot rely on invite-only. Security comes from our side: **no `ccms` metadata = no access**, and metadata is set only by the Identity service (backend) |
| **`iss`** shared by all apps | Tokens from other PUP systems carry the same issuer | **`azp` allowlist (our subdomain only) + `ccms.account_id` bound to `clerk_user_id` are mandatory**. This keeps Decision 2 = no `aud` acceptable. If a reviewer still wants `aud`, a JWT template remains the fallback |
| **Secret Key** is per instance, not per app | Our Identity service would hold a key that can modify **all** users of all PUP systems | Treat it as highly sensitive: only the Identity Vercel project, only `public_metadata.ccms` writes (deep merge, never replace), audited. Ask the provider whether a restricted key exists **[OPEN]** |
| **Password / sign-in methods** | Set by the provider for everyone | Decision 4 follows whatever they enabled. Existing PUP Clerk users already have credentials, so only CCMS-only staff need first-sign-in setup |

### 17.3 Dev or prod: answer **development first**
- Clerk production keys do not work on Vercel preview domains, and dev users cannot be moved to production [DOC managing-environments, migrate-overview]. So building and testing must happen on the **development instance** (`pk_test_…`, limit 100 users), using test accounts only.
- **Production** keys are requested only at Phase 4 (Section 9.2), after staging passes and with the subdomain live.
- Ask for now (development):
  - publishable key;
  - JWKS public key (PEM);
  - Frontend API URL;
  - **secret key, delivered directly into the Identity project's Vercel environment, not through chat.**

### 17.4 Subdomain request
- **Only the frontend needs a `pupqc.tech` subdomain [V].** The browser talks only to the frontend. The gateway and the services are reached server-side through the `/api/*` rewrite (`apps/frontend/next.config.js`).
- Proposed name: **`ccms.pupqc.tech`** → the CCMS frontend Vercel project **[R]**. The provider adds the DNS record using the exact target Vercel shows when the domain is added to the project.
- The production `azp` allowlist then becomes `https://ccms.pupqc.tech`.
- After cutover, users must use `ccms.pupqc.tech`, because production Clerk keys do not work on `*.vercel.app` [DOC].
- Adding a domain to the Vercel project is additive; the current URL keeps working until we switch. It is still a production change and needs approval before anyone does it.
- **[OPEN]** The current production URL of the CCMS frontend, and whether another domain is already in use.

### 17.5 Decision status after the provider response
| # | Decision | Status |
|---|---|---|
| 1 | Verifier: `verifyToken` + `jwtKey` in `ccms-shared` | Unchanged (recommended) |
| 2 | No `aud`; rely on `iss` + `azp` + account binding | Still recommended, **but** the instance is shared, so `azp` and binding are mandatory, not optional |
| 3 | Linking | **Changed:** look up by email first, then `createUser` only if missing; link via `public_metadata.ccms` (not `externalId`) |
| 4 | Passwords | Depends on provider's sign-in methods; existing PUP Clerk users need nothing |
| — | Deactivation | **Changed:** remove `ccms` metadata + CCMS `is_active=false`; **never ban** |

### 17.6 Development instance settings shared by the provider (screenshot, 2026-11-13)

**Test mode: ON.**
- Any email with the `+clerk_test` subaddress is a test address (e.g. `name+clerk_test@example.com`).
- No email or SMS is sent to test addresses. They verify with Clerk's fixed test code (the standard public Clerk test code, not a secret).
- Test phone numbers: `+1 555 555 01xx` with `xx` from 00 to 99 (that is, 0100 to 0199).

**Use [R]:**
- Every staging/QA account in the CCMS staging database uses a `+clerk_test` email. No real staff email is used on the development instance; it is capped at 100 users and shared with other teams.
- The CCMS email rule accepts `+` [V `EMAIL_RE` in `accounts.js`], so these addresses can be created through the normal CCMS account screen.
- Test mode must be **off on production**. Confirm with the provider before Phase 4 **[OPEN]**.

**User impersonation: ON.**
- Dashboard members of the shared application can sign in *as* a user. The resulting session token carries an `act` (actor) claim [DOC session-tokens].
- Impact on CCMS [R]:
  - A provider-team dashboard member could act in CCMS as a Super Admin. CCMS's audit trail would record the action under that Super Admin, because `actor` comes from the token `sub`/`account_id` [V `recordAudit` uses the caller].
  - Development: allow it, and log `act.sub` when present.
  - Production: **reject tokens that carry `act`** (401 `IMPERSONATION_NOT_ALLOWED`). Alternatively, accept them only for read requests, recording `act.sub` in the audit entry.
  - Ask the provider whether impersonation will be enabled on production and who the dashboard members are **[OPEN]**.

---

## 18. Approved Direction: "Landas 1" (Shared Clerk Access Playbook)

*Added 2026-11-14. **Supersedes** every recommendation in Sections 4-17 that gives CCMS a Clerk Secret Key, writes `public_metadata`, uses `createUser`/invitations/ban, puts roles in Clerk claims, or binds accounts by email.*

### 18.1 Inputs that changed the design
| Source | Statement |
|---|---|
| FMS team (instance owner) | No shared Clerk master secret (their ADR-0002/0003). A Secret Key controls **every** user of FMS, SMS and CCCMS (e.g. `POST /v1/sign_in_tokens` can sign in as anyone) |
| Owner answers | Sign-up is **closed** (`restricted`, invite-only); an `email` session claim exists (`{{user.primary_email_address}}`); `http://localhost:3000` allowed; test mode and impersonation **off** in production; production values coming; subdomain **`cccms.pupqc.tech`** approved |
| *Shared Clerk Access Playbook* (FMS · SMS · CCCMS) | R1 roles only in each app's DB · R2 metadata only under `public_metadata.cccms` · **R3 bind by issuer + `sub`, never by email** · R4 never delete/ban/lock/edit a Clerk user · R5 revoke only own invitations · R6 exact-email search only · R7 instance settings belong to the owner · R8 secret key server-only, no real emails in tests. D1 (per-app secret key) is **undecided** |
| Clerk docs (Section 16) | Session tokens: 60 s, no `aud`, `azp` = origin; networkless verification with the PEM needs no Secret Key |

### 18.2 Architecture (as built on branch `feat/cccms-clerk-landas1`)
```
Browser ── Clerk sign-in (owner's instance; invite-only) ── Clerk session token (60 s)
   │  POST /api/identity/auth/clerk/exchange   Authorization: Bearer <Clerk token>
   ▼
Identity (the only CCMS service that reads Clerk tokens; no Secret Key)
   verify: RS256 · PEM (CLERK_JWT_KEY, several allowed for rotation) · iss = CLERK_ISSUER · exp/nbf ±5 s
           azp ∈ CLERK_AUTHORIZED_PARTIES (required) · sub = user_… · sid · v = 2 · sts ≠ pending · no act
   look up account_clerk_links (issuer, sub)
     bound + active   → 200: the usual CCMS access token (role, office from accounts), NO refresh cookie
     bound + inactive → 403 ACCOUNT_INACTIVE
     not bound        → 403 CCMS_ACCESS_PENDING ("No access yet") + clerk_access_requests row (email = hint)
Super Admin (CCMS token): sees pending sign-ins (+ exact-email suggestion) → binds a specific sub to an account
Gateway, Core, Operations, Oversight: UNCHANGED (they keep verifying CCMS tokens offline)
```

### 18.3 Decisions, final
| # | Decision | Final |
|---|---|---|
| 1 | Who verifies Clerk tokens | **Identity only**, with `jose` + the PEM (no new dependency, no Secret Key). Gateway/services untouched |
| 2 | `aud` | Not required (not in session tokens). `iss` + required `azp` allowlist + issuer/sub binding |
| 3 | Linking | **Super Admin binds a specific Clerk user (issuer + sub) after that person signs in once.** Email is only a suggestion. No `createUser`, no metadata writes |
| 4 | Passwords | Clerk owns credentials (owner's policy: password ≥15 chars, email code, email link). CCMS hashes untouched; legacy login keeps working during the dual period |
| — | Deactivation | CCMS-only (`is_active=false` → `ACCOUNT_INACTIVE`) or remove the binding. Nothing in Clerk changes (R4) |
| — | New people without a Clerk account | Owner invites them (playbook D1 fallback) until D1 is decided |

### 18.4 Implemented in Phase 1 (backend; flag off by default)
| File | Purpose |
|---|---|
| `apps/identity-service/migrations/1795100000000-ClerkAccountLinks.js`, `sql/…up.sql`, `clerk-links-schema.json`, `migrations/index.js` | Two new tables: `account_clerk_links` (PK account_id; UNIQUE issuer+sub) and `clerk_access_requests` (PK issuer+sub). `accounts` untouched. Down refuses to drop rows without `CCMS_ALLOW_DATA_LOSS` |
| `src/lib/entities/index.js` | Matching entities (verified: `db:sync` output equals the frozen migration contract) |
| `src/lib/clerk.js` | Settings + Clerk token verification (checks in 18.2) |
| `src/lib/clerk-access.js` | Exchange, pending list, link (only a pending request; one-to-one), unlink (never your own), dismiss. Audits `ACCOUNT_CLERK_LINKED` / `ACCOUNT_CLERK_UNLINKED` by account ID, no email |
| `src/app/api/auth/clerk/exchange/route.js` | Public (already under `/api/auth/` in the gateway allowlist; no gateway change). Rate limit 30 / 5 min per Clerk user |
| `src/app/api/clerk-access/requests[/{id}]`, `clerk-access/links`, `accounts/{id}/clerk-link` | Super Admin only. All Clerk routes answer 404 while `CLERK_AUTH_ENABLED` is not `true` |
| `test/clerk.test.js` | 33 tests: every rejection case, rotation, 503 vs 401, impersonation, email-never-grants, one-to-one binding, deactivation, unlink rules, role checks |
| `.env.example` | `CLERK_AUTH_ENABLED`, `CLERK_ISSUER`, `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES`, `CLERK_EMAIL_CLAIM`, `CLERK_ALLOW_IMPERSONATION` |
| `scripts/migrations.test.mjs` | Identity revert list includes the new migration |

Results: Identity **151/151** (118 existing + 33 new); lint and `check:time` clean; a mutation check (azp check removed) made exactly the 2 azp tests fail. Migration safety suite: 32/34; the 2 failures are **pre-existing**: the Operations revert lists (lines 383 and 452) were not updated for `Cc057ServiceRatings1795000100000` from upstream commit `63ca134`.

### 18.5 Not done yet
1. **Frontend** (Clerk sign-in, "No access yet" page, Super Admin pending-sign-ins panel, linked status on Accounts). This is blocked on a decision: the working tree holds a large set of **uncommitted frontend changes made outside this work** (including `login/page.js`, `AppShell.js`, `accounts/page.js`), and they must not be overwritten.
2. Account creation without a password in Clerk mode (an unusable `clerk$` marker; `password_hash` is NOT NULL).
3. The pre-existing Operations revert-list fix (18.4), as its own change.
4. Production: values from the owner, `cccms.pupqc.tech` on the frontend Vercel project, the hosted migration through the runbook.

### 18.6 Playbook alignment and deviations
| Item | CCCMS |
|---|---|
| R1, R3, R4, R7, R8 | Followed |
| R2 | Nothing written to Clerk (no Secret Key); `public_metadata.cccms` reserved for later |
| R5, R6 | Not applicable until CCCMS has a key (no invitations, no search) |
| Access-management role | **Deviation:** the Super Admin holds it (4 fixed roles with a DB CHECK). Can become a CC056-style switch later |
| Last admin / own admin | Last Super Admin protection already exists; a Super Admin cannot remove their own Clerk binding |
| Change log by account ID | Yes for the new events (no email). The existing account audit still carries email in before/after: review separately |

### 18.7 Draft reply to the playbook (D1-D4)
> **D1:** CCCMS will not request a secret key for now. We verify tokens with the JWT public key only. A CCCMS Super Admin approves each person *after* their first sign-in, by Clerk issuer + user ID. Until D1 is agreed, new staff without a Clerk account need an invitation from the instance owner; we will send you the exact emails.
> **D2:** Please allow `https://cccms.pupqc.tech` as a domain and redirect for production. We'll send the exact DNS target once the domain is added to our Vercel project.
> **D3:** Agreed on `public_metadata.cccms`. We write nothing there today.
> **D4:** We had planned email-based binding like SMS. We switched to issuer + `sub` with admin approval; the email claim is shown to the admin only as a hint.

---

## 19. Phase 1 Complete: Frontend, Password-less Accounts, Local Test, Runbook

*Added 2026-11-14. Branch `feat/cccms-clerk-landas1`, not pushed.*

### 19.1 Commits (branch `feat/cccms-clerk-landas1`, oldest first)
| Commit | Content |
|---|---|
| `712523c` | Identity: migration, Clerk verification, exchange, Super Admin binding (Section 18.4) |
| `c235674` | Identity: while Clerk is on, an account can be created without a password (`password_hash` = marker `clerk$`; the password sign-in always answers 401 for it) |
| `3fa7cdb` | Frontend: `NEXT_PUBLIC_AUTH_PROVIDER` switch, Clerk-aware `session.js`, `ClerkProvider` only while on, `/login/clerk`, `/access-pending`, the Super Admin access screen, the "Sign in with your PUP account" bar on `/login` (through a new `app/login/layout.js`), `@clerk/nextjs` 7.9.26 |
| `b6395a9` | Fix the endless reload on `/login/clerk`: catch-all route `/login/clerk/[[...rest]]` with Clerk's path routing; a pending Clerk session no longer counts as signed out; dual-mode Sign out also ends the Clerk session |
| `a1d4a26` | UI redesign (separate work, same branch). For Clerk it moved the Super Admin screen into the **Accounts page, "Clerk Sign-in Access" tab** (`/settings/clerk-access` now redirects to `/accounts?tab=clerk`) and uses client-side navigation after sign-in. **See 19.6 item 1** |
| `a9d6468` | Fix tests left stale by upstream Sprint 7 changes (19.5) |
| `c49902b` | This document in `docs/`, and `scripts/clerk-config-check.mjs` |
| *"Clerk access: restore approval in one unified table"* | Fixes 19.6 item 1. Accounts > Clerk Sign-in Access becomes **one table** for pending and approved people: Search, a Status filter (All / Pending / Approved) and one Refresh. Pending rows keep the full approval step: choose the CCMS account (the exact-email match first, as a hint), then Approve or Dismiss. Approved rows have Remove (never your own). A regression test fails if the screen ever stops calling the approval APIs |

Verified on `a9d6468` (local, Windows, PostgreSQL 16 for tests):

| Suite | Result |
|---|---|
| `ccms-shared` | 82/82 |
| `api-gateway` | 59/59 |
| `core-service` | 594/594 |
| `operations-service` | 429/429 |
| `oversight-service` | 164/164 |
| `identity-service` | 153/153 |
| `frontend` | 1085/1085 |
| `test:safety` (migrations) | 50/50 |
| `test:integration` | 10/10 (1 intentionally skipped without the mock CSV/XLSX fixture folder) |

Also verified:
- Lint is clean.
- `next build` passes with Clerk off and with Clerk on (as of `b6395a9`).
- The time-usage scan finds nothing in any workspace. Note: `npm run check:time` is a silent no-op on Windows, because its "run as CLI" guard compares a `file://` URL with a backslash path. It runs correctly on the Linux CI. The script was left unchanged.

### 19.2 Local test (done)
The local `.env.local` files (gitignored) hold the **public** development-instance values. Identity has `CLERK_AUTH_ENABLED=true`, the issuer, the PEM and `CLERK_AUTHORIZED_PARTIES=http://localhost:3000`. The frontend has `NEXT_PUBLIC_AUTH_PROVIDER=dual` and the publishable key.

| Check | Result |
|---|---|
| Exchange without a token, and with a forged token | 401 `INVALID_CLERK_TOKEN`. A 503 would have meant broken configuration |
| Admin routes without a CCMS token | 401 |
| `/login` | Shows "Sign in with your PUP account"; the password sign-in still works |
| `/login/clerk` | Loads `clerk.browser.js` from the development instance |

**End-to-end sign-in (done, 2026-11-14).** One real person was invited by the instance owner to the development instance, using their own mailbox. Test-mode `+clerk_test` addresses receive no email at all, so they cannot accept an invitation.

| Step | Result |
|---|---|
| Google account not yet invited signs in | Clerk: "Couldn't find your account" (restricted sign-up works) |
| Invited person signs in at `/login/clerk` | "No access yet"; one row in `clerk_access_requests` with the email as a hint |
| Super Admin creates a CCMS account with that email | Still "No access yet": a matching email alone grants nothing (R3) |
| Super Admin approves the person | One row in `account_clerk_links` (issuer = development instance); one `ACCOUNT_CLERK_LINKED` audit event with account and Clerk IDs only, no email; the pending request is removed |
| "Check again" | The person lands on their role's page |

Issues found and fixed during the test:
- An endless reload on `/login/clerk`, caused by hash routing (fixed in `b6395a9`).
- Clerk's **email link** fails when it is opened in another tab: "you need to supply an active session". Google and email code work. Suggested to the owner: turn email link off for the instance.

Still open: decode one real token to close check C8 / O1 (`aud` absent, `azp` = the frontend origin).

### 19.3 Deferred: Accounts form
`apps/frontend/src/app/accounts/page.js` belonged to the UI redesign (now committed in `a1d4a26`) and still requires a password when creating an account. Make these changes there:
1. `import { clerkEnabled } from '../../lib/auth/provider.js'`.
2. In the create submit (around the `passwordStatus(form.password)` check), skip the blocking check when `clerkEnabled() && !form.password`. Send `password` only when it is filled.
3. Label the password field "Password (optional: the person can sign in with their PUP account)" while `clerkEnabled()`.
4. Optional: hide "Reset password" for accounts that are linked to Clerk (`GET /api/identity/clerk-access/links`).

The backend already accepts a missing password only while Clerk is on (`c235674`).

### 19.4 Production runbook (not executed; each step needs approval)
| # | Step | Owner |
|---|---|---|
| 1 | Merge `feat/cccms-clerk-landas1` into `codebase-for-deployment` after review, with CI green. **Pushing or merging to `codebase-for-deployment` deploys to production on Vercel**, so merge only with the switches off | CCMS |
| 2 | Receive the production instance's public values (Frontend API URL, PEM, `pk_live_` publishable key); run the checker in 15.2.3 | Owner → CCMS |
| 3 | **Done 2026-11-14:** `cccms.pupqc.tech` is on the frontend Vercel project (CNAME plus `_vercel` TXT ownership verification at Name.com) and serves CCMS over HTTPS. Still needed from the owner: `cccms` in Allowed subdomains and the redirect `https://cccms.pupqc.tech/login/clerk` on the production instance (playbook D2) | CCMS + owner |
| 4 | Rehearse the Identity migration `ClerkAccountLinks1795100000000` on a Neon branch (`migrate:show`, `migrate:run`, revert), then run it on production with `DB_TARGET=hosted --confirm=<db>` and the direct admin URL | CCMS |
| 5 | Identity production env: `CLERK_ISSUER`, `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES=https://cccms.pupqc.tech`; keep `CLERK_AUTH_ENABLED=false` for now. **No Clerk secret key anywhere** | CCMS |
| 6 | Frontend production env: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_…`, `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=true`; keep `NEXT_PUBLIC_AUTH_PROVIDER=legacy`. Deploy. Nothing changes for users | CCMS |
| 7 | Turn on: Identity `CLERK_AUTH_ENABLED=true`, frontend `NEXT_PUBLIC_AUTH_PROVIDER=dual`, redeploy. Two Super Admins sign in with Clerk and get approved first (lockout protection) | CCMS |
| 8 | Staff sign in with their PUP account; Super Admins approve them. People without a PUP account are invited by the owner | CCMS + owner |
| 9 | Later, with its own approval: `NEXT_PUBLIC_AUTH_PROVIDER=clerk` | CCMS |

**Rollback:** set `NEXT_PUBLIC_AUTH_PROVIDER=legacy` and `CLERK_AUTH_ENABLED=false`, then redeploy. Password sign-in works throughout (hashes untouched). The two new tables can stay; they are inert when Clerk is off.

### 19.5 Pre-existing test failures (found during this work; fixed in `a9d6468`)
These came from upstream changes; the application code was right and the tests were stale. Only the tests were changed.

1. `scripts/migrations.test.mjs` (2) and `scripts/tt2-migrations.test.mjs` (4): the newest-first revert lists missed `Cc057ServiceRatings1795000100000` (Operations) and `Cc055NotificationReads1795000000000` (Oversight).
2. `scripts/analytics-feed.test.mjs` (2): the cleanup deleted `transactions` before its children. `transaction_receipts` (CC045) and `service_ratings` (CC057) have a foreign key to it.
3. `apps/frontend/tests/unit/transaction-list.test.js` (1): `01b2a29` deliberately keys the detail page by role and address; the check still expected `key={id}`.

### 19.6 Open items before pushing
1. ~~Approval screen missing after the redesign.~~ **Fixed** (see 19.1, "Clerk access: restore approval in one unified table").
   - The cause: `a1d4a26` moved the Super Admin screen into the Accounts page's "Clerk Sign-in Access" tab, but kept only the approved list.
   - The fix was verified in the browser on 2026-11-14:
     - Remove an approved person: they are back to "No access yet".
     - Refresh: they show as Pending, with their account pre-selected.
     - Approve, then "Check again": they are signed in.
2. Accounts form password (19.3).
3. Decode one real token (19.2).
