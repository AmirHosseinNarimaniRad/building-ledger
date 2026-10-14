# Deploying Building Ledger

One server, Docker Compose: Postgres, a one-off migration job, the app, nginx (HTTPS) and a daily
backup job. Tested end to end: the full browser suite (`npm run e2e`) passes against this stack,
and a backup restores to an identical database with the ledger rules intact.

```
internet ──443──► nginx ──► app (Next.js, :3000) ──► db (Postgres 16, not exposed)
                                 │                      ▲
                                 └── /data/storage      └── backup (daily pg_dump + receipts)
```

## 1. Before you start

- A Linux server with Docker and the Compose plugin. 1 vCPU / 2 GB RAM is plenty for a pilot.
- A short domain pointing at the server (an `A` record). Short matters: the link goes in every
  SMS, and the charge SMS must fit two Persian parts.
- Docker Hub and npm may be blocked from Iranian servers. Either build the image elsewhere and
  push it to a registry the server can reach (step 2a), or set `NODE_IMAGE`, `POSTGRES_IMAGE`,
  `NGINX_IMAGE` and `NPM_REGISTRY` in `.env` to mirrors.

## 2. Get the code and the image

```sh
git clone https://github.com/AmirHosseinNarimaniRad/building-ledger.git
cd building-ledger/deploy
```

**2a. Build elsewhere, push, pull** (when the server can't reach Docker Hub/npm). On a machine
that can:

```sh
docker build -t registry.example.ir/building-ledger:1 ..   # from deploy/, or `.` from the repo root
docker push registry.example.ir/building-ledger:1
```

Then set `APP_IMAGE=registry.example.ir/building-ledger:1` in `.env` on the server. The server
also needs `postgres:16-alpine` and `nginx:1.27-alpine` (or mirrors of them).

**2b. Build on the server** (when it can reach them): nothing to do, step 5 builds it.

## 3. Configure

```sh
cp .env.example .env
openssl rand -hex 24        # → POSTGRES_PASSWORD
openssl rand -hex 24        # → APP_DB_PASSWORD
openssl rand -base64 32     # → RESIDENT_TOKEN_KEY
```

Fill in `.env`: `DOMAIN` and the three secrets. Keep a copy of `.env` somewhere safe, off the
server. **Losing `RESIDENT_TOKEN_KEY` breaks every resident link** (the manager can issue new
ones per unit, but residents would need new SMS).

## 4. HTTPS certificate

First issue, before nginx is running (port 80 must be free):

```sh
docker run --rm -p 80:80 -v "$PWD/letsencrypt:/etc/letsencrypt" certbot/certbot \
  certonly --standalone -d "$DOMAIN" --agree-tos -m you@example.com --no-eff-email
```

Renewal (nginx serves the challenge folder), e.g. a weekly cron job:

```sh
docker run --rm -v "$PWD/letsencrypt:/etc/letsencrypt" -v ledger_certbot-www:/var/www/certbot \
  certbot/certbot renew --webroot -w /var/www/certbot \
  && docker compose -f docker-compose.prod.yml --env-file .env exec nginx nginx -s reload
```

Using a CDN or your own certificate instead: put `fullchain.pem` and `privkey.pem` in
`letsencrypt/live/<DOMAIN>/`. If a CDN sits in front, make sure nginx still sees the real client
address (the rate limits depend on it); see the note under *Security*.

## 5. Start

```sh
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml --env-file .env ps
curl https://$DOMAIN/api/health          # → {"ok":true}
```

`migrate` runs the database migrations and exits; `app` waits for it. Open `https://<DOMAIN>/login`.

Until an SMS panel is connected (`SMS_SENDER=console`), login codes and resident links are only
printed in the app log:

```sh
docker compose -f docker-compose.prod.yml --env-file .env logs -f app | grep sms
```

## 6. Backups — do not skip

The `backup` service writes `backups/ledger-<time>.dump` (database) and
`backups/storage-<time>.tar.gz` (receipt images) at start-up and then daily, keeping 14 days.
**They are on the same disk as the data.** Copy them off the server every day, e.g. a cron job:

```sh
rsync -a backups/ backup-user@other-host:/backups/ledger/
```

Restore (stops nothing else; do it with the app stopped for a real recovery):

```sh
docker compose -f docker-compose.prod.yml --env-file .env stop app
docker compose -f docker-compose.prod.yml --env-file .env exec -T db \
  pg_restore -U ledger_owner -d ledger --clean --if-exists < backups/ledger-<time>.dump
docker run --rm -v ledger_storage:/data -v "$PWD/backups:/b" alpine \
  sh -c 'rm -rf /data/storage && tar -xzf /b/storage-<time>.tar.gz -C /data'
docker compose -f docker-compose.prod.yml --env-file .env start app
```

Try a restore once on a spare database before you rely on it (see the root README's tests).

## 7. Updating

```sh
git pull
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

New migrations apply automatically before the app starts. Migrations only move forward: to roll
back, restore the last backup taken before the update.

## Security notes

- Only nginx is exposed. Postgres has no published port.
- The app connects as `app_user`, which cannot change the schema or `TRUNCATE`; the ledger's
  append-only rules live in the database itself.
- nginx overwrites `X-Real-IP` and `X-Forwarded-For` with the connecting address. If you put a
  CDN or another proxy in front, configure nginx's `real_ip` module to trust only that proxy,
  or every client will look like the CDN and share one rate limit.
- Resident links (`/r/…`) are never written to nginx's access log.
- The `/r/*` rate limit is in memory: correct for this single-server setup only.
