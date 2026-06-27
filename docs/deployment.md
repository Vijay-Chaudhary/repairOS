# RepairOS — Production Deployment & Operations Guide

Production deployment of RepairOS to a **Hostinger KVM 2 VPS** (Ubuntu 24.04,
2 vCPU / 8 GB / 100 GB NVMe) via a GitHub Actions CI/CD pipeline.

> Requires a **VPS** (KVM). Shared/Cloud hosting cannot run Docker/Django/Celery.

---

## 1. Architecture

```
Internet
   │  (Cloudflare optional)
   ▼
 Nginx  ── TLS, HTTP/2, rate-limit, gzip, security headers
   ├──────────────► Next.js (frontend, standalone)
   └──────────────► Django / Daphne (ASGI, WebSockets)
                       │
                       ├── PgBouncer ──► PostgreSQL 16
                       ├── Redis (/0 broker · /1 cache · /2 channels)
                       └── MinIO (S3-compatible media)
   Celery worker + Celery beat ──► Redis + PostgreSQL
```

CI/CD: **push to `master` → test gate → build images → push to GHCR → SSH deploy
→ health gate → auto-rollback on failure.** See `.github/workflows/ci-cd.yml`.

---

## 2. Folder structure (infrastructure)

```
docker-compose.yml            # DEV stack (Mailpit, Adminer, HMR, mounts)
docker-compose.prod.yml       # PROD stack (GHCR images, limits, logging, no dev svcs)
.env.production.example        # PROD env template → copy to .env on the server
.github/workflows/ci-cd.yml    # pipeline
backend/
  Dockerfile                   # multi-stage; prod stage runs as non-root
  entrypoint.production.sh      # migrate master + tenants → collectstatic → daphne
  ci-known-failures.txt         # tests deselected by the CI gate (option b)
  .dockerignore
frontend/
  Dockerfile                   # prod = Next.js standalone, non-root
  .dockerignore
infra/
  nginx/nginx.production.conf   # TLS, rate-limit, headers, /static, /media, ACME
  postgres/{init.sh,postgresql.conf}
  redis/redis.conf
  pgbouncer/{Dockerfile,pgbouncer.ini,entrypoint.sh}
  scripts/                      # server-init, deploy, update, rollback, backup,
                                #   restore, healthcheck, _common
  monitoring/resource-alert.sh
docs/deployment.md             # this file
```

---

## 3. One-time server bootstrap

SSH in as root and run the bootstrap (installs Docker, creates the `deploy`
user, swap, UFW, Fail2Ban, SSH hardening, unattended-upgrades — idempotent):

```bash
# as root
git clone https://github.com/Vijay-Chaudhary/repairOS.git /opt/repairOS-bootstrap
DEPLOY_USER=deploy bash /opt/repairOS-bootstrap/infra/scripts/server-init.sh
```

Add the deploy SSH key, then re-run or `systemctl restart ssh` to enforce
key-only login:

```bash
ssh-keygen -t ed25519 -f deploy_key -N "" -C "github-actions"  # on your laptop
ssh-copy-id -i deploy_key.pub deploy@<VPS_HOST>
```

Clone the repo into the deploy dir and create the env file:

```bash
sudo -iu deploy
git clone https://github.com/Vijay-Chaudhary/repairOS.git ~/repairOS
cd ~/repairOS
cp .env.production.example .env
nano .env            # fill EVERY CHANGE-ME value (see §4)
chmod 600 .env
```

---

## 4. Environment variables

All production config lives in `.env` on the server (never committed). Generate
fresh secrets — never reuse dev values:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(50))"   # SECRET_KEY / JWT_SIGNING_KEY
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # TENANT_CRED_ENCRYPTION_KEY
openssl rand -base64 24                                          # DB / Redis / MinIO passwords
```

Key groups (full template in `.env.production.example`):

| Group | Vars |
|---|---|
| Images | `BACKEND_IMAGE`, `FRONTEND_IMAGE` (set by CI each deploy) |
| Postgres | `POSTGRES_SUPERUSER_PASSWORD`, `MASTER_DB_PASSWORD`, `MASTER_DATABASE_URL` |
| PgBouncer | `PGBOUNCER_ADMIN_PASSWORD`, `PGBOUNCER_AUTH_PASSWORD`, `TENANT_DB_HOST=pgbouncer` |
| Redis | `REDIS_PASSWORD` + `REDIS_URL` (/0), `REDIS_CACHE_URL` (/1), `REDIS_CHANNELS_URL` (/2) — password embedded in each URL |
| Django | `DJANGO_SETTINGS_MODULE=config.settings.production`, `SECRET_KEY`, `JWT_SIGNING_KEY`, `TENANT_CRED_ENCRYPTION_KEY`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `API_DOMAIN` |
| Storage | `USE_S3=True`, `AWS_*`, `AWS_S3_ENDPOINT_URL`, `AWS_S3_CUSTOM_DOMAIN`, `MINIO_ROOT_*` |
| Email/integrations | `EMAIL_*`, `MSG91_*`, `WHATSAPP_*`, `RAZORPAY_*` |
| Observability | `SENTRY_DSN` |

`NEXT_PUBLIC_*` are **build-time** for the frontend — set them as GitHub
repository **Variables**, not in `.env` (see §7).

---

## 5. DNS & TLS

DNS `A` records → VPS IP: `app`, `api`, `*.api`, `media` (all under `repaiross.app`),
plus apex.

Issue Let's Encrypt certs (the nginx config expects
`/etc/letsencrypt/live/repaiross.app/`):

```bash
sudo apt-get install -y certbot
sudo certbot certonly --standalone \
  -d repaiross.app -d app.repaiross.app -d api.repaiross.app -d media.repaiross.app \
  --cert-name repaiross.app
# Wildcard tenant API (*.api) needs DNS-01:
# sudo certbot certonly --manual --preferred-challenges dns \
#   -d '*.api.repaiross.app' --cert-name repaiross.app
```

Auto-reload nginx after renewal:

```bash
sudo certbot renew --deploy-hook \
  "cd /home/deploy/repairOS && docker compose -f docker-compose.prod.yml exec nginx nginx -s reload"
```

---

## 6. Resource budget (8 GB box)

| Service | CPU limit | Mem limit | Notes |
|---|---|---|---|
| postgres | 1.0 | 2 GB | `shared_buffers=512M`, `effective_cache_size=1.5G` |
| backend (Daphne) | 1.0 | 768 MB | ASGI |
| celery-worker | 1.0 | 768 MB | concurrency 2 + child recycling |
| celery-beat | 0.25 | 256 MB | scheduler |
| redis | 0.5 | 512 MB | `maxmemory 448m`, AOF+RDB |
| frontend | 0.5 | 512 MB | standalone |
| minio | 0.5 | 512 MB | object storage |
| nginx | 0.25 | 96 MB | |
| pgbouncer | 0.25 | 64 MB | |

≈ 2 GB reserved for Ubuntu + a 2 GB swapfile. Limits are caps (OOM protection);
normal usage is well below. CPU limits intentionally oversubscribe 2 vCPU
(bursting), which is fine since services rarely peak together.

---

## 7. GitHub configuration

**Secrets** (Settings → Secrets and variables → Actions → Secrets):

| Secret | Value |
|---|---|
| `VPS_HOST` / `VPS_USER` / `VPS_SSH_PORT` | server IP / `deploy` / `22` |
| `VPS_SSH_KEY` | private deploy key |
| `VPS_DEPLOY_DIR` | `/home/deploy/repairOS` |
| `GHCR_USER` / `GHCR_TOKEN` | username + PAT (`read:packages`) for the VPS to pull images |

**Variables** (baked into the frontend at build time):
`NEXT_PUBLIC_API_URL=https://api.repaiross.app`,
`NEXT_PUBLIC_WS_URL=wss://api.repaiross.app`,
`NEXT_PUBLIC_MINIO_URL=https://media.repaiross.app`.

### CI test gate (option b)

The pipeline runs the full suite minus the node IDs in
`backend/ci-known-failures.txt` (pre-existing failures, verified independent of
the infra work). **After the first CI run, reconcile that file** against the real
pinned-env failures (Py3.11 / Django 5.1.7 / pytest 8.3.3) and trim it. Coverage
is reported but not enforced in CI.

---

## 8. First deploy

The first rollout has no images on the VPS yet, so push to `master` once (CI
builds + pushes), then on the server:

```bash
cd ~/repairOS
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
export BACKEND_IMAGE=ghcr.io/vijay-chaudhary/repaiross-backend:latest
export FRONTEND_IMAGE=ghcr.io/vijay-chaudhary/repaiross-frontend:latest
bash infra/scripts/deploy.sh
```

The backend entrypoint migrates the master DB + every tenant, runs
`collectstatic`, then starts Daphne — **no demo seeding in production.**

Provision the first tenant:

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py create_tenant --slug acme --name "Acme Repairs" \
    --email admin@acme.com --phone +91XXXXXXXXXX \
    --admin-password 'STRONG-PASSWORD' --plan professional
```

Thereafter every push to `master` deploys automatically.

---

## 9. Operations scripts (`infra/scripts/`)

| Script | Purpose |
|---|---|
| `server-init.sh` | One-time VPS bootstrap + hardening (run as root) |
| `deploy.sh [sha]` | Pull images, `up -d`, health gate |
| `update.sh [sha]` | `git pull` + deploy |
| `rollback.sh <sha>` | Re-deploy a previous image tag |
| `backup.sh` | `pg_dumpall` (gzip, verified) + MinIO mirror + rotation |
| `restore.sh <file>` | Restore DB from a backup (confirmation required) |
| `healthcheck.sh` | Probe all services + `/api/v1/health/` (non-zero on failure) |

Common commands:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate_all_tenants
```

---

## 10. Backup & restore

```bash
# Backup (cron-friendly). Keeps 7 by default; override:
RETENTION=14 BACKUP_DIR=/mnt/backups bash infra/scripts/backup.sh

# Suggested cron (deploy user): nightly 03:15
15 3 * * *  cd /home/deploy/repairOS && bash infra/scripts/backup.sh >> ~/backup.log 2>&1

# Restore (DESTRUCTIVE — prompts for confirmation)
bash infra/scripts/restore.sh ./backups/pg-YYYYMMDD-HHMMSS.sql.gz
```

`pg_dumpall` captures the master DB, **all tenant DBs**, and roles in one
consistent dump. Store copies off-box (S3/rsync) for real DR.

---

## 11. Monitoring

Lightweight, no agents:

- **Container health**: every service has a healthcheck + `restart: unless-stopped`.
- **Host metrics**: `infra/monitoring/resource-alert.sh` checks disk/RAM/load/
  unhealthy containers; cron every 5 min, optional `ALERT_WEBHOOK` (Slack/Discord):

  ```bash
  */5 * * * * ALERT_WEBHOOK=https://hooks... /home/deploy/repairOS/infra/monitoring/resource-alert.sh
  ```
- **Logs**: json-file driver, rotated at 10 MB × 3 per container (no disk blowup).
- **Errors**: set `SENTRY_DSN` for application error reporting.

---

## 12. Scaling

Vertical first (simplest): bump the Hostinger plan, then raise the limits in
`docker-compose.prod.yml` and `shared_buffers`/`maxmemory`.

Horizontal levers before leaving one box:
- More Celery throughput: raise `--concurrency` or run a second `celery-worker`.
- Heavier DB: move PostgreSQL to a managed instance (see §14) — PgBouncer/URL
  config already supports it.
- Offload media/CDN: point `AWS_S3_CUSTOM_DOMAIN` at CloudFront.

---

## 13. Disaster recovery

| Scenario | Recovery |
|---|---|
| Bad deploy | Auto-rollback (health gate). Manual: `rollback.sh <previous-sha>` |
| Data loss / corruption | `restore.sh <latest backup>`; provision a fresh VPS via `server-init.sh` if needed |
| VPS lost | New VPS → `server-init.sh` → clone repo → restore `.env` (from your secret store) → `restore.sh` → `deploy.sh` |
| Cert expiry | `certbot renew` (timer) + nginx reload hook |

RTO depends on backup freshness — keep nightly off-box backups.

---

## 14. Future AWS migration

Designed to be env-only:

| Now (Hostinger) | AWS | Change |
|---|---|---|
| postgres + pgbouncer containers | RDS (+ RDS Proxy) | `MASTER_DATABASE_URL`, `TENANT_DB_HOST` |
| redis container | ElastiCache | `REDIS_*` URLs |
| minio container | S3 | drop `AWS_S3_ENDPOINT_URL`, set real bucket/keys |
| nginx media proxy | CloudFront | `AWS_S3_CUSTOM_DOMAIN` |
| single VPS | Lightsail → EC2 | same compose, or ECS later |

No business-logic/model/API changes required.

---

## 15. Production checklist

- [ ] `server-init.sh` run; SSH key-only; UFW + Fail2Ban active; swap on
- [ ] `.env` filled with fresh secrets, `chmod 600`, **not** committed
- [ ] DNS records resolve; TLS certs issued; nginx reload hook set
- [ ] GitHub Secrets + Variables configured
- [ ] First deploy green; `/api/v1/health/` returns 200 over HTTPS
- [ ] First tenant provisioned and reachable at its subdomain
- [ ] `ci-known-failures.txt` reconciled against the first real CI run
- [ ] Nightly `backup.sh` cron + off-box copy verified by a test `restore.sh`
- [ ] `resource-alert.sh` cron + `ALERT_WEBHOOK` set; `SENTRY_DSN` set
- [ ] Rollback tested (`rollback.sh <sha>`)

---

## 16. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `docker login` fails on VPS | `GHCR_TOKEN` lacks `read:packages`, or package is private |
| Backend `DisallowedHost` | Host missing from `ALLOWED_HOSTS` |
| Frontend calls `localhost:8000` | `NEXT_PUBLIC_*` Variables not set when the image was built — set + re-push |
| `502` from nginx | backend/frontend unhealthy — `docker compose ps`, logs |
| nginx won't start | certs missing at `/etc/letsencrypt/live/repaiross.app/` — issue them (§5) |
| Redis `NOAUTH` | `REDIS_PASSWORD` not embedded in the `REDIS_*` URLs |
| Media 403/404 | bucket missing (`minio-init`), or `AWS_S3_CUSTOM_DOMAIN` path wrong |
| Celery idle | broker URL `/0` mismatch, or Redis auth failing |
| OOM kills | lower Celery concurrency / Postgres `shared_buffers`; confirm swap on |
