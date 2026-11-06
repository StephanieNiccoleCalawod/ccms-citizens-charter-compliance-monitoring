# ccms-frontend

Every screen of the Citizen's Charter Compliance/Monitoring System (CCMS): the public home and service pages, sign-in and password
reset, the signed-in Home, Accounts, Offices, Services (with fees and who may avail), and the Calendar.
The frontend owns **all UI**. Identity and Core have no pages any more.

Stack: Next.js (App Router, plain JavaScript) · Tailwind CSS. No TypeScript, no Material UI. It has no database and holds no secret.

```
ccms-frontend/
├── public/                     # pup-logo.png
├── src/
│   ├── app/                    # pages: /, /login, /reset-password, /accounts, /office, /campus,
│   │                           #        /offices, /services, /services/[id], /public/[id], /calendar
│   ├── components/
│   │   ├── layout/             # AppShell (sidebar + top bar), PublicHeader
│   │   ├── navigation/         # Pager
│   │   ├── forms/              # ServiceForm
│   │   ├── modals/  dialogs/  feedback/  ui/
│   └── lib/
│       ├── api/                # client.js (apiFetch, publicFetch), identity.js, catalogue.js, calendar.js
│       ├── auth/               # session.js (token + refresh), guards.js, permissions.js
│       └── constants/          # brand.js
├── tests/unit/                 # node:test
├── vendor/ccms-shared/         # only the role and navigation tables are used (ccms-shared/roles, ccms-shared/nav)
└── next.config.js              # rewrites /api/* to the API gateway
```

## How it reaches the backend

The browser only ever calls its own address, `/api/...`. `next.config.js` rewrites that to `API_GATEWAY_URL` (the API gateway), which
checks the token and routes to Identity, Core and Logs. Because the browser sees one address, the sign-in cookies are ordinary
first-party cookies. The frontend never talks to a service directly and never touches a database (a unit test checks this).

- Access token (15 minutes): kept in memory and mirrored to `sessionStorage` (this tab only).
- Refresh token (7 days): httpOnly cookie set by Identity. A readable marker cookie `ccms_signed_in` says "someone is signed in"
  so a visitor with no session gets the public page with no network call.
- If Identity is briefly down, a page opened with a still-valid token keeps working; the user sees a clear message instead of being
  signed out. An expired or revoked refresh token (401) returns to sign-in.

## Run it

```bash
cp .env.example .env.local     # API_GATEWAY_URL=http://127.0.0.1:8080
npm install
npm run dev                    # http://localhost:3000
```

The gateway, Identity and Core must be running (the easy way: `ccms-local-stack`, `npm run dev`).

## Not built here

The PDF's tree also lists `dashboard`, `transactions`, `concerns`, `logs`, `reports`, `analytics`, `public/offices|concerns|status`,
`account`, `middleware.js` and the `charts/`, `tables/` component folders. Those belong to other groups' sprints (or are not in our
backlog) and are not created as empty stubs. Add them when their sprint arrives.
