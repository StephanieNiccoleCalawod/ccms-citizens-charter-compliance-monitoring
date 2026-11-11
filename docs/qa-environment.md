# TT5 — Separate QA environment

Implementation status: **local release checks recorded in [tt5-tt6-release-checks.md](tt5-tt6-release-checks.md); persistent hosted QA setup and acceptance evidence pending**. The PM's EB14 instructions require (1) a separate test database, (2) the fixture list ticked against it, (3) an automated QA report from the hosted system and (4) deployment checks. Those operational results remain pending until actually performed. Temporary local regression databases and initializer sandboxes do not establish a persistent hosted QA environment. The existing demo database and its audit history must never be used for QA fixtures or cleaned by deleting audit records.

## What the code provides

- `compose.qa.yml`: four dedicated PostgreSQL containers/volumes and a capture-only Mailpit mailbox. Ports are separate from normal development: Identity 16433, Core 16435, Operations 16436, Oversight 16437, mailbox SMTP 11025 and mailbox UI 18025. No demo volumes are mounted.
- `qa/targets.example.json`: separate addresses for all six QA apps, database identities and protected demo/production destinations. This file contains public configuration examples, not credentials.
- `qa/fixtures.example.json`: a source-controlled input format for the authoritative EB14 list, account/office fixtures and calendar fixture W. Approval is initially false and all checklist items are pending. The supplied task and PM screenshot identify requirements but do not supply fixture W's actual dates, times or complete fixture records.
- `scripts/qa/`: explicit initialization, numbered migrations, idempotent fixture setup, QA app startup, mock receivers and an opt-in wrapper for the existing browser automation scripts. None runs during install, normal development, build or deployment.
- QA runtime guards on app startup, database connections and mail delivery. QA requires its own target ID, issuer, URLs, four databases and capture mailbox; it refuses protected destinations and schema synchronization. Local QA uses `.next-qa` output so it can coexist with the usual local app output.
- `qa/deployed-risk-checklist.json`: seven deployment checks with pending status and no fabricated evidence or secrets.

Generated configuration, private keys, reports and fixture state belong under ignored `.qa/`. Private target/fixture inputs are ignored as `qa/targets.local.json` and `qa/fixtures.local.json`. Do not commit these files.

## Prepare a local QA set later

These instructions describe future setup of a persistent QA set. Only disposable local regression databases and temporary initializer sandboxes were used for the release checks.

1. Copy `qa/targets.example.json` to `qa/targets.local.json`. Keep QA URLs on loopback for `kind: "local"`. Complete the protected lists with every actual demo/production database identity and service alias before use.
2. Supply a fresh `QA_LOCAL_DATABASE_PASSWORD` for the dedicated Docker containers. Database names/owners are `ccms_identity_qa`, `ccms_core_qa`, `ccms_operations_qa` and `ccms_oversight_qa`. Start them explicitly with `npm run qa:db:up`. `qa:db:down` stops that project and preserves its volumes.
3. Supply the connection strings through the operator's environment, never through a committed file:

   | Variable | Destination |
   | --- | --- |
   | `QA_IDENTITY_DATABASE_URL` | QA Identity runtime database |
   | `QA_CORE_DATABASE_URL` | QA Core runtime database |
   | `QA_OPERATIONS_DATABASE_URL` | QA Operations runtime database |
   | `QA_OVERSIGHT_DATABASE_URL` | `ccms_logs_writer` on the dedicated QA Oversight server |
   | `QA_IDENTITY_DATABASE_ADMIN_URL` | QA Identity owner, if different |
   | `QA_CORE_DATABASE_ADMIN_URL` | QA Core owner, if different |
   | `QA_OPERATIONS_DATABASE_ADMIN_URL` | QA Operations owner, if different |
   | `QA_OVERSIGHT_DATABASE_ADMIN_URL` | QA Oversight owner; mandatory and different from runtime |

   Percent-encode special characters in URL credentials. Database identities contain only normalized host, port and database name, for example `127.0.0.1:16433/ccms_identity_qa`. Neon `-pooler` aliases normalize to their direct endpoint identity.
4. Run `npm run qa:init` to generate `.qa/env/<app>.env`, its own signing key, shared service key, cron secret, mock credentials and fixture password. This command prepares files without connecting to a service or database. It never overwrites the normal `.env.local` files or an existing `.qa` set. Passwords and private keys must remain private. Existing conventional env-file keys are shadowed, without copying their values, to prevent production credentials leaking into QA through Next's env loading.
5. Run `npm run qa:migrate` explicitly. It invokes each service's numbered migrations with its QA owner connection, never schema synchronization. Oversight baseline provisions its restricted writer using the QA runtime URL's password. It must run before starting Oversight, because that writer may not exist yet.
6. Start `npm run qa:dev` and `npm run qa:mocks` in separate terminals when ready. QA app ports are frontend 3300, Identity 3301, Oversight 3302, Core 3303, Operations 3304 and gateway 8380; mocks listen on 4400. These commands start processes; they do not run a QA suite.
7. Supply the reviewed EB14 fixture pack and run `npm run qa:fixtures` explicitly. Core must be available when office-bound Identity accounts are created because Identity uses Core's normal office API. Use the generated fixture password from the private Identity QA env file for initial sign-in; no password is written to the fixture pack or evidence report.

Initialization does not provision databases, deploy apps, schedule jobs or establish any acceptance evidence. Do not replace missing prerequisites with the demo database or the ordinary development seed command.

## Fixture pack and evidence

Set `approved: true` only after the authoritative complete EB14 list and fixture W records have been supplied. Record their revision in `sourceReference` and `fixtureW.sourceReference`. The example is deliberately incomplete and cannot be executed as an approved fixture pack.

- `superAdmin`: `email`, `fullName`, `employeeNo`. The email must end in `.test`.
- `offices`: `{ "key": "office-alias", "office_code": "APPROVED-QA-CODE", "office_name": "Approved QA Office" }` entries from the fixture list.
- `accounts`: normal Identity creation fields `employee_no`, `full_name`, `email`, `role`, optional `position`, plus `office_key` for Office Head/Staff. Executive accounts have no office. Include the four roles across the administrator and accounts. No supplied password or direct foreign office ID is accepted.
- `fixtureW.catalogueSettings`: optional normal Core settings (`institution_code`, `applies_to_enabled`) required by the approved fixture. Institution code remains immutable under normal domain rules.
- `fixtureW.workingHours`: exactly seven normal schedule items with `day_of_week` 0–6, `is_working`, `opening_time`, `closing_time`. Copy W's actual values; no substitute schedule is generated.
- `fixtureW.entries`: W's actual exception records, each with a unique `key`, optional `office_key`, and normal calendar fields such as `exception_date`, `exception_type`, `description`, `is_recurring`, `applies_to`, `class_mode`, `suspended_from`, `suspended_until`.
- `checklist`: the complete authoritative list, with stable IDs and requirement text. Keep `calendar-w`, `accounts`, `mailbox`, `mock-fms`, `mock-scms` for the five referenced resources and include every other authoritative item. Input statuses are never accepted as proof of creation.

The loader creates the administrator, offices/calendar and remaining accounts in that order using domain functions, retaining normal audit events **inside QA**. It records safe IDs and actual `Exists`/`Created` states under `.qa/fixture-state.json`, keeps progress after partial failure and refuses a different existing fixture instead of resetting accounts, passwords or calendar entries. Running it again reuses matching records. There is no cleanup of audit history.

Mailbox, mock receiver and any additional EB14 checklist entries stay `PENDING` until their actual setup evidence is recorded by the responsible operator. Their existence is not inferred from configuration. Do not claim EB14 complete while any entry is pending.

## Dedicated mock receivers

The mock service accepts FMS calendar pushes at `/fms/calendar` and SCMS/SMS pushes below `/scms/`, using separate receiver Bearer tokens. It makes no outbound request and retains only bounded message IDs and counters, not request payloads or credentials.

An authenticated `GET /control` exposes safe attempt/acceptance counters and the QA target ID. An authenticated `POST /control` accepts `system: "FMS" | "SCMS"` and `status: 200 | 401 | 429 | 503` for a later integration exercise. The control Bearer token is the generated `QA_MOCK_CONTROL_TOKEN`. Simulated 401 responses are counted and let a later TT6 check distinguish one request from automatic retries. None was sent during implementation. State is in memory and resets when the mock process restarts.

Mail goes to the dedicated capture SMTP server, with `.test` fixture addresses and no real provider credentials. Keep the capture server configured without outbound relaying.

## Separate hosted QA setup

Use separate deployment projects for the six QA apps, four dedicated databases and a dedicated HTTPS mock receiver/capture mailbox. Set `kind: "hosted"` and a distinct `qa-*` target ID in the private target input. All six app origins plus mock/mailbox origins must be HTTPS and must not be localhost or a protected alias. Configure UTC, `DB_TARGET=hosted` and `DB_SYNCHRONIZE=false`; the initializer prepares these markers and its own authentication keys. QA service-to-service URLs must remain within the same QA set.

**Oversight needs an isolated PostgreSQL cluster or isolated Neon branch**, not merely another database name on a demo cluster: its baseline provisions the fixed, cluster-wide `ccms_logs_writer`/`ccms_oversight_app` roles. The `isolatedCluster: true` flag records this operator requirement; it does not create a branch or prove physical isolation. The guard also refuses a known protected host/port for Oversight. Include both direct and pooled aliases and all actual protected targets when preparing the private configuration.

Use the generated QA settings in QA projects only. Runtime deployments do not need `DATABASE_ADMIN_URL`, `LOGS_WRITER_PASSWORD`, `OVERSIGHT_APP_PASSWORD`, `QA_FIXTURE_PASSWORD` or the mock control token; keep these in the operator environment or dedicated mock service, not ordinary app deployments. Owner credentials are for the explicit migration step. Keep the Oversight runtime connection restricted as `ccms_logs_writer`.

Give hosted mocks their own process behind the configured HTTPS origin and explicitly set `QA_MOCK_BIND_HOST` and `PORT` when starting the supplied receiver. The local Mailpit container is a local capture service, not a hosted deployment. Provision and protect a dedicated hosted capture mailbox separately.

Configure QA-only scheduled jobs and their QA `CRON_SECRET` explicitly; normal deployment configuration does not establish their successful execution. Publishing the application code does not create the hosted QA resources or configure its cron jobs and environments.

## Deferred suite and deployment evidence

When testing is authorized later, `npm run qa:run -- smoke` runs the existing smoke script against the configured QA frontend using the QA administrator. `transactions`, `public` and `completion` select other existing browser scripts. Approved fixtures must already be created. Reports, exit status, timestamp, target ID and a redacted output log are saved to `.qa/reports/` only when a suite is actually run.

The existing browser scripts contain mocked API sections. The wrapper identifies that limitation; those sections do not establish hosted backend coverage. A local report does not satisfy the hosted-system report requirement. Do not treat the wrapper itself, or a mocked browser result, as proof that all hosted services work.

Complete `qa/deployed-risk-checklist.json` later with actual results and safe evidence for environment settings, jobs/cron authentication, cookies/HTTPS, service URLs, UTC time, capture mail and request size. Keep credentials, tokens, connection strings and mailbox contents out of reports. All hosted QA checks remain `PENDING`/`NOT_RUN` in the committed template. Local regression results and any read-only production release probes are separate from the EB14 hosted QA suite and acceptance checklist.
