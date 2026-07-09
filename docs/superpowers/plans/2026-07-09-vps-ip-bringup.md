# Bare-IP VPS Bring-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the existing RepairOS stack up on the fresh Hostinger VPS at `http://200.97.165.67` over plain HTTP, provision the first tenant + platform admin, and smoke-test one flow through the UI.

**Architecture:** Reuse `docker-compose.prod.yml` unchanged; layer a small `docker-compose.ip.yml` override that (a) builds the backend/frontend images **on the box** (Approach A) instead of pulling from GHCR, and (b) swaps the TLS/subdomain nginx config for an HTTP-only, path-based one. Make the four HTTPS-enforcing Django flags env-toggleable so the app works over HTTP. Real production path (compose.prod + nginx.production + CI) stays pristine for a later domain cutover.

**Tech Stack:** Django 4.2 / DRF, Next.js 14, PostgreSQL 16, pgbouncer, Redis, MinIO, nginx, Docker Compose, Ubuntu 24.04.

**Spec:** `docs/superpowers/specs/2026-07-09-vps-ip-bringup-design.md`

---

## Part 1 — Repo changes (local machine; committed + pushed)

### Task 1: Make the four HTTPS-enforcing flags env-driven

The stack runs over plain HTTP on the bare IP. `config/settings/production.py` hardcodes `SECURE_SSL_REDIRECT=True`, `SESSION_COOKIE_SECURE=True`, `CSRF_COOKIE_SECURE=True`, and HSTS — over HTTP these 301 every request to HTTPS and drop the session/CSRF cookies, making login impossible. Make them env-driven with `default=True`, so real production is byte-for-byte unchanged while the IP `.env` can set them `False`.

**Files:**
- Modify: `backend/config/settings/production.py:16-21`

- [ ] **Step 1: Edit the security block**

Replace lines 16–21 (the hardcoded block) with the env-driven version:

```python
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=31536000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", default=True)
SECURE_HSTS_PRELOAD = env.bool("SECURE_HSTS_PRELOAD", default=True)
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
SESSION_COOKIE_SECURE = env.bool("SESSION_COOKIE_SECURE", default=True)
CSRF_COOKIE_SECURE = env.bool("CSRF_COOKIE_SECURE", default=True)
```

Leave `SECURE_PROXY_SSL_HEADER`, `SECURE_REFERRER_POLICY`, `SECURE_CONTENT_TYPE_NOSNIFF`, and `X_FRAME_OPTIONS` (lines 22–25) exactly as they are.

- [ ] **Step 2: Verify defaults unchanged (no env set)**

Run from `backend/`:

```bash
DJANGO_SETTINGS_MODULE=config.settings.production \
SECRET_KEY=x ALLOWED_HOSTS=example.com \
MASTER_DATABASE_URL="sqlite://:memory:" \
TENANT_CRED_ENCRYPTION_KEY="STuYVoBE7R1taq32t1q26-jCPlqDpPlvUdbPcNPh7C0=" \
python -c "from django.conf import settings; print(settings.SECURE_SSL_REDIRECT, settings.SESSION_COOKIE_SECURE, settings.CSRF_COOKIE_SECURE, settings.SECURE_HSTS_SECONDS)"
```

Expected: `True True True 31536000`

- [ ] **Step 3: Verify the override works (flags off)**

```bash
DJANGO_SETTINGS_MODULE=config.settings.production \
SECRET_KEY=x ALLOWED_HOSTS=example.com \
MASTER_DATABASE_URL="sqlite://:memory:" \
TENANT_CRED_ENCRYPTION_KEY="STuYVoBE7R1taq32t1q26-jCPlqDpPlvUdbPcNPh7C0=" \
SECURE_SSL_REDIRECT=False SESSION_COOKIE_SECURE=False CSRF_COOKIE_SECURE=False SECURE_HSTS_SECONDS=0 \
python -c "from django.conf import settings; print(settings.SECURE_SSL_REDIRECT, settings.SESSION_COOKIE_SECURE, settings.CSRF_COOKIE_SECURE, settings.SECURE_HSTS_SECONDS)"
```

Expected: `False False False 0`

- [ ] **Step 4: Commit**

```bash
git add backend/config/settings/production.py
git commit -m "feat(settings): make HTTPS-enforcing flags env-toggleable (default True)"
```

---

### Task 2: Add the HTTP-only, path-based nginx config

`nginx.production.conf` needs TLS certs and subdomains and won't start on a bare IP. Add a sibling config that listens on port 80, routes by path, and proxies to the same upstreams. Modeled on `nginx.local.conf` but adds the prod rate-limit zones + gzip and routes `/media/` to MinIO.

**Files:**
- Create: `infra/nginx/nginx.ip.conf`

- [ ] **Step 1: Create the file**

```nginx
# RepairOS — Nginx bare-IP config (HTTP only, no TLS/domain).
# Single host on :80, path-based routing. Used with docker-compose.ip.yml
# until a domain + Let's Encrypt cutover switches back to nginx.production.conf.
#
#   /            → Next.js frontend (:3000)
#   /api/, /ws/  → Django backend (:8000)
#   /static/     → collected Django static assets (shared volume)
#   /media/      → MinIO object storage (:9000)

upstream backend {
    server backend:8000;
    keepalive 32;
}
upstream frontend {
    server frontend:3000;
    keepalive 16;
}
upstream minio {
    server minio:9000;
    keepalive 16;
}

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

limit_req_zone $binary_remote_addr zone=api:10m  rate=30r/s;
limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/s;
limit_req_status 429;

gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 256;
gzip_types
    application/json application/javascript application/xml
    text/plain text/css text/javascript image/svg+xml
    application/x-font-ttf font/woff2;

server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 50M;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location /static/ {
        alias /app/staticfiles/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /media/ {
        proxy_pass http://minio;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location ~ ^/api/v1/(auth|token) {
        limit_req zone=auth burst=10 nodelay;
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        limit_req zone=api burst=60 nodelay;
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
    }

    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add infra/nginx/nginx.ip.conf
git commit -m "feat(nginx): add HTTP-only, path-based bare-IP config"
```

---

### Task 3: Add the compose override for on-box build + IP nginx

`docker-compose.prod.yml` pulls `backend`/`frontend`/`celery-*` from GHCR (no `build:`). This override adds build contexts (so `up --build` builds locally with the bare-IP `NEXT_PUBLIC_*` baked into the frontend), pins all app services to local image tags, and swaps nginx's mounted config + drops the Let's Encrypt mount.

Compose **replaces** sequence keys (`volumes:`, `ports:`, `build.args:`) rather than merging them, so each list below is written in full.

**Files:**
- Create: `docker-compose.ip.yml`

- [ ] **Step 1: Create the file**

```yaml
# RepairOS — bare-IP override for docker-compose.prod.yml (Approach A).
#
#   docker compose -f docker-compose.prod.yml -f docker-compose.ip.yml up -d --build
#
# Builds backend + frontend on the box (no GHCR), serves plain HTTP on :80.
# NEXT_PUBLIC_* are read from .env and inlined into the frontend at build time.

services:
  backend:
    build:
      context: backend
      target: production
    image: repaiross-backend:ip

  celery-worker:
    image: repaiross-backend:ip

  celery-beat:
    image: repaiross-backend:ip

  frontend:
    build:
      context: frontend
      target: production
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}
        NEXT_PUBLIC_WS_URL: ${NEXT_PUBLIC_WS_URL}
        NEXT_PUBLIC_MINIO_URL: ${NEXT_PUBLIC_MINIO_URL}
    image: repaiross-frontend:ip

  nginx:
    ports:
      - "80:80"
    volumes:
      - ./infra/nginx/nginx.ip.conf:/etc/nginx/conf.d/default.conf:ro
      - static_files:/app/staticfiles:ro
```

Note: `celery-worker`/`celery-beat` only set `image:` (no `build:`) — they reuse the image the `backend` service builds. Compose builds `backend` first because `--build` builds every service with a `build:` context; the celery services then pull the now-local `repaiross-backend:ip` tag.

- [ ] **Step 2: Validate the merged config resolves (locally, with a throwaway env)**

Run from the repo root:

```bash
NEXT_PUBLIC_API_URL=http://200.97.165.67/api \
NEXT_PUBLIC_WS_URL=ws://200.97.165.67/ws \
NEXT_PUBLIC_MINIO_URL=http://200.97.165.67/media \
docker compose -f docker-compose.prod.yml -f docker-compose.ip.yml --env-file /dev/null config >/tmp/ip-config.yml && \
grep -E "repaiross-(backend|frontend):ip|nginx.ip.conf|\"80:80\"|- 80:80" /tmp/ip-config.yml
```

Expected: the resolved config prints without error, and grep shows `repaiross-backend:ip`, `repaiross-frontend:ip`, the `nginx.ip.conf` mount, and the `80:80` port. (Ignore warnings about other unset `.env` vars — this only validates structure, not a real deploy.)

- [ ] **Step 3: Commit**

```bash
git add docker-compose.ip.yml
git commit -m "feat(compose): add bare-IP override (on-box build + HTTP nginx)"
```

---

### Task 4: Add the one-command bring-up script

A thin wrapper so the on-box deploy is one command and mirrors the existing `deploy.sh` health-gate style.

**Files:**
- Create: `infra/scripts/deploy-ip.sh`

- [ ] **Step 1: Create the file**

```bash
#!/usr/bin/env bash
# Build + start the bare-IP stack on the VPS and wait for backend health.
# Run from anywhere; resolves the repo root from its own location.
#
#   bash infra/scripts/deploy-ip.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

COMPOSE=(docker compose -f docker-compose.prod.yml -f docker-compose.ip.yml)

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

log "Building images on the box and starting the stack"
"${COMPOSE[@]}" up -d --build --remove-orphans

log "Waiting for backend to become healthy (up to ~180s)"
for i in $(seq 1 36); do
  state="$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | awk '$1=="backend"{print $2}')"
  [[ "$state" == "healthy" ]] && { log "Backend healthy ✓"; break; }
  sleep 5
done

state="$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | awk '$1=="backend"{print $2}')"
if [[ "$state" != "healthy" ]]; then
  log "Backend did not become healthy — recent logs:"
  "${COMPOSE[@]}" logs --tail 50 backend
  exit 1
fi

log "Stack up. Reachable at http://200.97.165.67"
```

- [ ] **Step 2: Make executable + commit**

```bash
chmod +x infra/scripts/deploy-ip.sh
git add infra/scripts/deploy-ip.sh
git commit -m "feat(scripts): add bare-IP one-command bring-up"
```

---

### Task 5: Push Part 1

- [ ] **Step 1: Push to master**

```bash
git push origin master
```

Expected: the four Part-1 commits land on `origin/master` so the VPS can clone them.

---

## Part 2 — VPS bring-up (run on the server)

> These tasks run on the VPS. Where a command runs as a specific user it's noted. The SSH key is supplied by the user at execution time; it is not stored in the repo.

### Task 6: Bootstrap and harden the server

**Files:** (uses existing `infra/scripts/server-init.sh`)

- [ ] **Step 1: SSH in as root**

```bash
ssh root@200.97.165.67
```

Expected: root shell on Ubuntu 24.04.

- [ ] **Step 2: Fetch and run the bootstrap script**

The script installs Docker + compose, creates the `deploy` user (in the `docker` group), configures a 2 GB swap, and applies UFW/Fail2Ban/SSH/unattended-upgrades hardening.

```bash
curl -fsSL https://raw.githubusercontent.com/Vijay-Chaudhary/repairOS/master/infra/scripts/server-init.sh -o /root/server-init.sh
DEPLOY_USER=deploy bash /root/server-init.sh
```

Expected: green `==>` log lines through to completion, no errors. (If the repo is private and the raw URL 404s, `scp` the script up instead: from the local machine `scp infra/scripts/server-init.sh root@200.97.165.67:/root/` then run it.)

- [ ] **Step 3: Open the firewall for HTTP + SSH**

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw status
```

Expected: `ufw status` shows `22/tcp ALLOW` and `80/tcp ALLOW`. (Do **not** open 443 — no TLS yet.)

- [ ] **Step 4: Confirm Docker works for the deploy user**

```bash
su - deploy -c "docker version --format '{{.Server.Version}}'"
```

Expected: a Docker server version prints with no permission error.

---

### Task 7: Get the code onto the box

The repo is private. Use a read-only deploy key (preferred) so the box can `git pull` future changes.

**Files:** (clones into `/home/deploy/repairos`)

- [ ] **Step 1: As `deploy`, generate a deploy key**

```bash
su - deploy
ssh-keygen -t ed25519 -f ~/.ssh/repairos_deploy -N "" -C "vps-deploy@200.97.165.67"
cat ~/.ssh/repairos_deploy.pub
```

Expected: prints a public key. Add it at GitHub → repo **Settings → Deploy keys → Add deploy key** (read-only, no write access needed).

- [ ] **Step 2: Configure SSH to use that key for GitHub**

```bash
cat > ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/repairos_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -o StrictHostKeyChecking=accept-new -T git@github.com || true
```

Expected: GitHub replies `Hi Vijay-Chaudhary/repairOS! You've successfully authenticated…` (the `|| true` swallows GitHub's non-zero exit).

- [ ] **Step 3: Clone**

```bash
git clone git@github.com:Vijay-Chaudhary/repairOS.git ~/repairos
cd ~/repairos && git rev-parse --short HEAD
```

Expected: clone succeeds; the printed SHA matches the tip of `master` you pushed in Task 5.

---

### Task 8: Create the production `.env` for HTTP/IP

**Files:**
- Create: `/home/deploy/repairos/.env` (uncommitted; `.gitignore` already excludes `.env`)

- [ ] **Step 1: Copy the template**

```bash
cd ~/repairos
cp .env.production.example .env
```

- [ ] **Step 2: Generate real secrets**

```bash
echo "SECRET_KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(64))')"
echo "TENANT_CRED_ENCRYPTION_KEY=$(python3 -c 'import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())')"
for v in POSTGRES_SUPERUSER_PASSWORD MASTER_DB_PASSWORD PGBOUNCER_AUTH_PASSWORD MINIO_ROOT_PASSWORD REDIS_PASSWORD; do
  echo "$v=$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')"
done
```

Expected: prints one line per secret. Paste each value into the matching key in `.env` (use `nano .env`). If `.env.production.example` names any of these differently, match the template's key names — do not add duplicates.

- [ ] **Step 3: Set the HTTP/IP-specific values**

Edit `.env` so these keys hold exactly these values (the four `SECURE_*` flags are the ones made env-driven in Task 1):

```dotenv
DJANGO_SETTINGS_MODULE=config.settings.production
ALLOWED_HOSTS=200.97.165.67,localhost,127.0.0.1
CSRF_TRUSTED_ORIGINS=http://200.97.165.67
CORS_ALLOWED_ORIGINS=http://200.97.165.67
NEXT_PUBLIC_API_URL=http://200.97.165.67/api
NEXT_PUBLIC_WS_URL=ws://200.97.165.67/ws
NEXT_PUBLIC_MINIO_URL=http://200.97.165.67/media
SECURE_SSL_REDIRECT=False
SESSION_COOKIE_SECURE=False
CSRF_COOKIE_SECURE=False
SECURE_HSTS_SECONDS=0
```

- [ ] **Step 4: Sanity-check no placeholders remain**

```bash
grep -nE "=(CHANGE_ME|changeme|your-|xxxx|)$" .env || echo "no empty/placeholder values ✓"
```

Expected: `no empty/placeholder values ✓` (or a list of keys you still need to fill — fill them, then re-run).

---

### Task 9: Build and start the stack

**Files:** (uses `deploy-ip.sh` from Task 4)

- [ ] **Step 1: Run the bring-up**

```bash
cd ~/repairos
bash infra/scripts/deploy-ip.sh
```

Expected: images build (a few minutes; the first frontend build is memory-heavy but the 2 GB swap covers it), the stack starts, and the script prints `Backend healthy ✓` then `Stack up. Reachable at http://200.97.165.67`.

- [ ] **Step 2: If pgbouncer crash-loops, clear the stale pidfile**

Only if `docker compose ... ps` shows `pgbouncer` restarting:

```bash
COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.ip.yml"
$COMPOSE stop pgbouncer
$COMPOSE run --rm --entrypoint sh pgbouncer -c 'rm -f /var/run/pgbouncer/pgbouncer.pid' || true
$COMPOSE up -d pgbouncer
```

Expected: pgbouncer reaches a stable running state.

- [ ] **Step 3: Confirm all services are up**

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.ip.yml ps
```

Expected: `postgres`, `pgbouncer`, `redis`, `backend` (healthy), `celery-worker`, `celery-beat`, `frontend`, `minio`, `minio-init` (exited 0 is fine for the init job), `nginx` — all Up.

- [ ] **Step 4: Confirm HTTP reachability from the box**

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost/api/v1/health/
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost/
```

Expected: `200` for the health endpoint and `200` (or `307`/`308` to a locale path) for the frontend.

---

### Task 10: Verify the tenant-provisioning bug, then seed

The `create_tenant` autocommit-desync bug (see spec §6) silently loses master-DB writes and strands tenants in "provisioning". Confirm it's resolved on `master` before provisioning the real first tenant.

**Files:** (uses `create_platform_admin`, `create_tenant` management commands)

- [ ] **Step 1: Confirm the fix is present in the checked-out code**

```bash
cd ~/repairos
git log --oneline -- backend/apps/*/management/commands/create_tenant.py backend/apps/tenants 2>/dev/null | head
grep -rnE "set_session|autocommit" backend/apps/*/management/commands/create_tenant.py backend/apps/tenants/services*.py 2>/dev/null | head
```

Expected: the create-tenant/provisioning path no longer toggles `autocommit`/`set_session` mid-transaction against the master connection (the desync fix is in `master`). If it still does, STOP and resolve before seeding — provisioning will silently fail.

- [ ] **Step 2: Create the platform admin (master DB)**

```bash
COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.ip.yml"
$COMPOSE exec -T backend python manage.py create_platform_admin \
  --email "you@yourdomain.com" \
  --full-name "Vijay Kumar" \
  --password 'CHOOSE_A_STRONG_PASSWORD'
```

Expected: prints success (platform admin created in the master DB). Use a real strong password you control — not the demo one.

- [ ] **Step 3: Provision the first tenant**

```bash
$COMPOSE exec -T backend python manage.py create_tenant \
  --slug firstshop \
  --name "Your Shop Name" \
  --email "owner@yourdomain.com" \
  --phone "+919999999999" \
  --admin-password 'CHOOSE_A_STRONG_PASSWORD' \
  --plan professional
```

Expected: prints success and the tenant reaches an **active** (not "provisioning") state.

- [ ] **Step 4: Verify the tenant is active in the master DB**

```bash
$COMPOSE exec -T backend python manage.py shell -c \
"from django.apps import apps; T=[m for m in apps.get_models() if m.__name__=='Tenant'][0]; import sys; print([(t.slug, getattr(t,'status', getattr(t,'is_active','?'))) for t in T.objects.using('default').all()])"
```

Expected: a list including `('firstshop', ...)` with an active/ready status — **not** stuck provisioning. (If the model/field names differ, list tenants via `create_tenant`'s own output or the Django admin instead.)

---

### Task 11: Smoke-test through the UI

Per project preference, drive the real frontend — do not shortcut via the API.

- [ ] **Step 1: Load the app in a browser**

Open `http://200.97.165.67/` on your machine.

Expected: the RepairOS frontend renders (styled, no console errors about mixed content or blocked HTTPS). Note: the PWA "install" prompt will **not** appear — expected over HTTP.

- [ ] **Step 2: Log in as the platform admin**

Go to `http://200.97.165.67/admin/login` and sign in with the platform-admin credentials from Task 10 Step 2.

Expected: successful login lands on the platform dashboard (no redirect loop to HTTPS, cookies accepted).

- [ ] **Step 3: Log in to the tenant workspace + exercise one flow**

Log in to the `firstshop` tenant with the tenant-admin credentials from Task 10 Step 3, then create one record end-to-end (e.g. a customer in CRM or a repair job) and confirm it saves and reappears after a refresh.

Expected: the record persists across a page reload — confirms the full request path (nginx → frontend → `/api` → backend → pgbouncer → tenant DB) works over HTTP on the bare IP.

- [ ] **Step 4: Record the outcome**

Note in the deploy notes (or reply) which flow was exercised and that it passed. If anything failed, capture `docker compose -f docker-compose.prod.yml -f docker-compose.ip.yml logs --tail 100 backend nginx` for diagnosis.

---

## Done / deferred

When this plan completes, RepairOS is live at `http://200.97.165.67` with the first tenant + platform admin and one verified flow. The following stay deferred to the **domain-cutover** session (spec §7): real domain + DNS, Let's Encrypt TLS (switch back to `nginx.production.conf`, flip the four `SECURE_*` flags back to `True`, update `NEXT_PUBLIC_*`/`ALLOWED_HOSTS` to the HTTPS domain and rebuild the frontend), PWA re-enable, and wiring GitHub Actions secrets for one-click GHCR deploys (Approach B).
