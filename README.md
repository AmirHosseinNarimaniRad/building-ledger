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

`npm run db:reset` wipes the dev database, re-applies migrations and seeds again.

## Ledger rules

The rules are enforced in Postgres, not only in app code (`db/migrations/002_ledger_rules.sql`):

- An entry is a draft until it is shown to a resident, its month's charge is issued, or 30
  minutes pass. Drafts are edited in place.
- After that, `UPDATE` and `DELETE` are rejected. An edit becomes a reversal plus a new version,
  both carrying a reason that residents see.
- The app connects as `app_user`, which has no DDL or `TRUNCATE` rights.
- Balances are views that sum every row (`db/migrations/003_balance_views.sql`).
