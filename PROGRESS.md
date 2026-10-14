# Progress

The working log for this project: where it stands, what is next, and the decisions behind it.
Read this first when picking the work up; update it at the end of every step.

**Last updated:** 2026-10-14
**Current step:** waiting on the owner: SMS account + template approval, domain, server
**Next step:** deploy, connect the approved SMS templates, then 9 (pilot)

## Steps

| Step | What | Status |
| --- | --- | --- |
| 0 | Project setup: Next.js, Postgres in Docker, repo | Done |
| 1 | Database and ledger rules (append-only triggers, roles, balance views) | Done |
| 2 | Charge calculation: four formulas, toman rounding | Done |
| 3 | OTP login, buildings, units, bulk unit grid | Done |
| 4 | Expenses, payments, documents, the ledger, edit/void with revisions | Done |
| 5 | Charges, resident links, the resident page | Done |
| 6 | Arrears, SMS reminders, monthly report, PWA | Done |
| — | Production deployment: Docker image, Compose, nginx, backups | Done |
| 7 | Housekeeping: English README, this file, security audit, status doc | Done |
| 8 | SMS: Kavenegar + SMS.ir adapters, template texts, failure handling, test-send script | Code done; templates waiting on owner |
| 9 | Pilot with one real building (10–30 units) | Waiting on owner |
| 10 | Real receipt reader (VLM) for bank-receipt photos | Later, after the pilot |

## Step 8: what is done and what is left

Done (2026-10-14):
- Every SMS is a panel template (Kavenegar lookup / SMS.ir verify); `SMS_SENDER` picks the panel.
- Template texts to submit: `deploy/SMS.md`. `renderSms` in `lib/sms/shared.ts` must match them.
- Failures: login voids the code and says so; charge/reminder batches count unsent SMS on screen
  and stop after 3 failures in a row. Logs never contain numbers, texts or keys.
- Bad SMS settings make the server refuse every request (health check fails) via `instrumentation.ts`.
- `npm run sms:test -- <mobile>` / `node sms-test.cjs <mobile>` in the image sends one of each.
- Kavenegar's live API was probed with a fake key: response shape matches. SMS.ir's API is not
  reachable from outside Iran; its format comes from its official SDK and is unverified live.

Left (needs the owner):
- [ ] Choose a panel, open the account, submit the three templates
- [ ] After approval: set the `.env` values, run the test send, check the texts on a real phone
- [ ] If SMS.ir: confirm the success status (assumed `status: 1`) on the first real send

## Step 7 checklist

- [x] English README for GitHub
- [x] This progress file
- [x] Security audit and git-tracking check (results below)
- [x] Project status doc for the owner (Claude Doc, linked below)

## Verified state

- 75 unit tests pass (`npm test`).
- The 40-check browser test (`npm run e2e`) passes against dev, and against the production stack
  through nginx and HTTPS.
- The 11 PWA checks pass (`npm run e2e:pwa`).
- A backup restores to an identical database, with the ledger triggers intact.
- Not yet tested: a real server, a real SMS, a real phone outside the LAN, a real manager.

## Security audit (2026-10-14)

**Fixed in this step:**
- The dev Postgres port was published on every network interface with a dev password. It is
  now bound to `127.0.0.1`.
- nginx advertised its version. `server_tokens off`.

**Checked and fine:**
- Nothing secret is tracked or in history: `.env*` (except the two `.env.example` files),
  `*.pem`, `/storage`, `deploy/.env`, `deploy/letsencrypt` and `deploy/backups` are ignored. A
  scan for keys and passwords in tracked files found none.
- All commits are by the owner, with no AI attribution.
- `npm audit --omit=dev` shows 0 vulnerabilities. Five "high" advisories exist only in the lint
  toolchain (`eslint-config-next` → `braces`). They are dev-only, never shipped, and their only
  "fix" downgrades to Next 14, so they are left alone.
- Session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, and expires with the
  server-side session.
- `RESIDENT_TOKEN_KEY` must be 32 bytes; anything else fails loudly.
- Only nginx is exposed in production; HSTS and TLS 1.2+ only.

**Known limits (accepted for the prototype):**
- The `/r/*` rate limit is in memory: correct for one server only.
- No Content-Security-Policy header yet.
- Backups sit on the same disk until the owner sets up the off-server copy.

## Rules for working on this repo

- Everything on GitHub is in English: code, comments, docs, commit messages, the repo
  description. The only exception is user-facing UI text (and the tests that match it), which is
  Persian.
- Commits and PRs are by the owner only. Never add Claude as a co-author or contributor, and
  never add "Generated with Claude" lines.
- It is a prototype: keep fixes light and avoid heavy process.

## Links

- Project status doc (for the owner, updated with this file):
  https://claude.ai/code/artifact/85b5a05b-9232-46d0-82f4-4b5b805f8c24
- Deployment guide: [`deploy/README.md`](deploy/README.md)

## Log

| Date | Step | Note |
| --- | --- | --- |
| 2026-10-14 | 8 | SMS adapters (Kavenegar, SMS.ir), template texts, failure handling, test-send script |
| 2026-10-14 | 7 | README rewritten in English; this file added; security audit; Persian comments translated |
| 2026-10-14 | 1–2 of "after step 6" | Spec doc synced with the code; production deployment added and verified |
