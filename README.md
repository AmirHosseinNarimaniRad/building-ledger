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
npm run dev
npm test
```
