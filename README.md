# Building Ledger

A transparent ledger for residential buildings in Iran. The building manager records expenses and
payments and issues monthly charges. Each resident sees the building's books and their own bill
through a private SMS link, with no app to install and no account to create.

The golden rule: **once a financial record has been shown to anyone, it never changes silently.**
Later corrections are kept as visible revisions with a reason, for the manager and the residents
alike, and the database itself enforces this.

> **Status:** prototype. Steps 0–6 of the MVP are built and tested, and the production stack is
> ready. The app has not yet run on a real server or with a real building. See
> [`PROGRESS.md`](PROGRESS.md) for the current step.

The user interface is in Persian (right-to-left, Jalali calendar, toman amounts). The code,
documentation and commit history are in English.

## Features

**For the manager** (phone number + one-time SMS code):

- Set up a building and its units, with a fast bulk-entry grid for whole floors.
- Record expenses and income, with an optional receipt photo or PDF.
- Record resident payments, optionally from a photo of the bank receipt.
- Issue a monthly charge, split by one of four formulas: equal, by area, by occupants, or a
  fixed part plus an occupants part. Preview every unit's share before issuing.
- See the ledger, the building balance, the arrears list, and a printable monthly report.
- Send SMS reminders to units that owe money (at most one per unit per 24 hours).

**For residents** (a private link per unit, sent by SMS):

- The building's ledger: every expense with its receipt, and every revision with its reason.
- Building-wide totals and their own unit's charges, payments and balance.
- Nothing about any neighbour's unit.

**On the phone:** the app installs to the home screen as a PWA and shows an offline page with no
signal. It never caches pages or data.

## How the ledger stays honest

The rules live in PostgreSQL triggers, not only in application code
([`db/migrations/002_ledger_rules.sql`](db/migrations/002_ledger_rules.sql)):

- A new entry is a **draft**: for 30 minutes, until a resident sees it, or until its month's
  charge is issued, whichever comes first. A draft is edited in place.
- After that, the entry is **locked**: `UPDATE` and `DELETE` are rejected. An edit becomes a
  reversal plus a new version, both carrying the reason, and residents see both.
- The app connects as `app_user`, a role with no DDL or `TRUNCATE` rights.
- Balances and debts are views that sum every row
  ([`003_balance_views.sql`](db/migrations/003_balance_views.sql)). No stored total can drift.

Money is stored as `BIGINT` rial and is always a whole number of tomans. Dates are stored in the
Gregorian calendar, computed in Tehran time, and shown in the Jalali calendar.

## Stack

- [Next.js](https://nextjs.org) 16 (App Router, Server Actions) with TypeScript and React 19
- PostgreSQL 16 through [postgres.js](https://github.com/porsager/postgres); plain SQL migrations
- Tailwind CSS 4, the self-hosted Vazirmatn font
- Vitest for unit tests; Playwright (driving the installed Chrome) for end-to-end tests
- Docker Compose and nginx for production

## Project layout

```
app/              pages and Server Actions
  login/          OTP login
  app/b/[id]/     the manager's building: units, ledger, expenses, payments, charges, arrears, report
  r/[token]/      the resident page (read-only)
components/       shared UI (ledger row, badges, buttons)
lib/              domain logic, framework-free and unit-tested
  ledger/         entries, revisions, locking, balances
  charge/         charge splitting and issuing
  auth/           OTP codes and sessions
  sms/            SMS messages and senders: console (dev), Kavenegar, SMS.ir
  receipt/        receipt reader (mock for now)
db/migrations/    the schema, the ledger rules and the balance views
e2e/              browser tests: the full manager/resident flow and PWA installability
scripts/          migrate, seed, reset
deploy/           production: Docker Compose, nginx, backups, step-by-step guide
```

## Getting started

Requirements: Node.js 20+ and Docker.

```sh
cp .env.example .env.local      # then set RESIDENT_TOKEN_KEY (the file says how)
npm install
npm run db:up                   # Postgres in Docker, reachable from this machine only
npm run db:migrate
npm run db:seed                 # demo building: 20 units, a charge, payments, expenses
npm run dev                     # http://localhost:3000
```

Log in as the demo manager with `09120000000`. With `SMS_SENDER=console` (the default), login
codes and resident links are printed in the terminal instead of being sent.

`npm run db:reset` wipes the dev database, re-applies the migrations and seeds it again.

**On a phone on the same Wi-Fi:** set `APP_URL=http://<your-computer-ip>:3000` in `.env.local`,
run `npm run dev -- --hostname 0.0.0.0`, and open that address. The dev server allows
`APP_URL`'s host automatically.

## Tests

```sh
npm test                        # 75 unit tests on their own ledger_test database, recreated each run
npm run e2e                     # the full manager and resident flow in headless Chrome
npm run build && npm run e2e:pwa  # production build: installable, service worker, offline page
```

The end-to-end test logs in with the console SMS code, then bulk-adds units, records expenses
with documents and payments, issues a charge, opens the resident page and checks the arrears and
the report. Set `E2E_SHOTS=<dir>` to save screenshots, or `E2E_BASE_URL` to run it against
another server, such as the production stack.

## Security

- **Login:** six-digit SMS codes that expire after 5 minutes and allow 5 attempts, with at most
  5 codes an hour per phone and per IP. Sessions are server-side, in an `HttpOnly` cookie.
- **Access:** every building page and action checks that the signed-in user manages that
  building.
- **Resident links:** 128-bit random tokens. The database stores only their SHA-256 hash and an
  AES-256-GCM encrypted copy. Links expire after 180 days and are rotated automatically. Resident
  pages are rate-limited and sent with `noindex`, `no-referrer` and `no-store`, and nginx never
  logs them.
- **Uploads:** only JPEG, PNG, WebP and PDF are accepted, checked by their content, not their
  name, up to 10 MB. Files are served only to the building's manager or through a valid resident
  link.
- **Client IP:** taken from the reverse proxy's `X-Real-IP`, never from a client-supplied
  `X-Forwarded-For`, so the rate limits cannot be dodged.

Found a vulnerability? Please open a private
[security advisory](https://github.com/AmirHosseinNarimaniRad/building-ledger/security/advisories/new)
rather than a public issue.

## Deployment

See [`deploy/README.md`](deploy/README.md) for the step-by-step guide. In short, it is one server
running Docker Compose with Postgres, a migration job, the app, nginx with HTTPS, and a daily
backup of the database and the receipt files. The restore has been tested. The guide also covers
Iranian servers that cannot reach Docker Hub or npm.

Keep a copy of the production `.env` off the server: losing `RESIDENT_TOKEN_KEY` means every
resident needs a new link.

## SMS

Every SMS is a template approved in the provider's panel, sent through Kavenegar or SMS.ir and
chosen by `SMS_SENDER`. [`deploy/SMS.md`](deploy/SMS.md) has the template texts to submit, the
settings, and `sms:test`, which sends one of each to your phone. If the panel fails, nothing is lost:
login says so and can be retried, and charges are issued anyway, with the unsent SMS counted on screen.

## Roadmap

1. Approve the SMS templates and deploy to a server.
2. A pilot with one real building.
3. A real receipt reader for bank-receipt photos (currently a mock).

The full step-by-step history is in [`PROGRESS.md`](PROGRESS.md).
