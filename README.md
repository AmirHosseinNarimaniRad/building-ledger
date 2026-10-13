# دفتر شفاف ساختمان — Building Ledger

A web app that keeps a residential building's books, issues monthly charges, and lets each
resident see their own bill through an SMS link, with no sign-up.

The golden rule: once a financial record has been shown to anyone, it never changes silently.
Edits after that point are kept as visible revisions with a reason, for the manager and the residents.

**Status:** prototype, under active development.

## Stack

Next.js (App Router) + TypeScript, PostgreSQL 16, Tailwind. Money is stored as `BIGINT` rial;
dates are stored Gregorian and shown Jalali.

## Development

```sh
cp .env.example .env.local
npm install
npm run db:up        # Postgres in Docker
npm run db:migrate
npm run db:seed      # sample building: 20 units, a few ledger rows
npm run dev
npm test             # uses its own ledger_test database, recreated each run
```

`npm run e2e` drives the real flows in headless Chrome (login with the console SMS code, bulk
units, expenses, documents, payments). Set `E2E_SHOTS=<dir>` to save screenshots.

To try it on a phone on the same Wi-Fi: set `APP_URL=http://<your-mac-ip>:3000` in `.env.local`,
run `npm run dev -- --hostname 0.0.0.0`, and open the link from the SMS printed in the terminal.
The dev server allows `APP_URL`'s host automatically.

`npm run db:reset` wipes the dev database, re-applies migrations and seeds again.

## Ledger rules

The rules are enforced in Postgres, not only in app code (`db/migrations/002_ledger_rules.sql`):

- An entry is a draft until it is shown to a resident, its month's charge is issued, or 30
  minutes pass. Drafts are edited in place.
- After that, `UPDATE` and `DELETE` are rejected. An edit becomes a reversal plus a new version,
  both carrying a reason that residents see.
- The app connects as `app_user`, which has no DDL or `TRUNCATE` rights.
- Balances are views that sum every row (`db/migrations/003_balance_views.sql`).

## Deployment notes

- `RESIDENT_TOKEN_KEY` (32 random bytes, base64) encrypts resident link tokens at rest. Keep it
  outside the database; losing it means every resident needs a new link.
- `APP_URL` is the base of the links sent by SMS. Keep the domain short: the charge SMS must fit
  two Persian SMS parts.
- Put the app behind a reverse proxy that **overwrites** `X-Real-IP` with the client address.
  Rate limits (OTP, `/r/*`) rely on it and never trust a client-supplied `X-Forwarded-For`.
- The `/r/*` rate limit is in memory: fine for one server process, not for several.
