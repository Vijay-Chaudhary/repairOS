# RepairOS — Bare-IP VPS Bring-Up (Hostinger `200.97.165.67`)

**Date:** 2026-07-09
**Status:** Approved (design)
**Scope:** Deploy the existing RepairOS stack to a fresh Hostinger VPS reachable over plain HTTP at `http://200.97.165.67`, as a staging-grade environment. TLS, custom domain, PWA, and one-click CI/CD are explicitly deferred to a later "domain cutover" session.

---

## 1. Goal & end state

A running RepairOS stack on the hardened VPS, reachable at `http://200.97.165.67`, with:

- The full production stack up: postgres, pgbouncer, redis, backend, celery worker + beat, frontend, MinIO, nginx.
- The first tenant provisioned and a platform-admin account that can log in at `/admin/login`.
- One real end-to-end flow smoke-tested through the browser UI.

**Non-goals this session:** Let's Encrypt TLS, real domain/DNS, PWA/service-worker registration, and wiring GitHub Actions secrets for automated deploys. All deferred (see §7).

## 2. Why the existing prod path can't be used as-is

The repo already contains a complete production deployment (`docker-compose.prod.yml`, `infra/scripts/*`, `.github/workflows/ci-cd.yml`, `nginx.production.conf`). Three facts make it unusable on a bare IP over HTTP, and each has a targeted fix:

1. **`infra/nginx/nginx.production.conf` is TLS- and subdomain-only.** It references `/etc/letsencrypt/live/repaiross.app/...` certificates and routes by the `app.` / `*.api.` / `media.` subdomains. On a bare IP with no certs it will not start.
   → **Fix:** add a new `infra/nginx/nginx.ip.conf` — a single `server` on port 80, HTTP only, path-based routing.

2. **`docker-compose.prod.yml` expects pre-built GHCR images** (`backend`/`frontend` have `image:` refs, no `build:` context).
   → **Fix (Approach A, chosen):** build images **on the VPS** via a compose override that adds `build:` contexts, baking the bare-IP `NEXT_PUBLIC_*` URLs into the frontend build. No GHCR auth or CI setup required now.

3. **`config/settings/production.py` hardcodes HTTPS enforcement** — `SECURE_SSL_REDIRECT = True`, `SESSION_COOKIE_SECURE = True`, `CSRF_COOKIE_SECURE = True`, and HSTS. Over plain HTTP this 301-redirects every request to HTTPS and refuses to send the session/CSRF cookies, making login impossible.
   → **Fix:** make those four flags env-driven (`env.bool("...", default=True)`) so real production is unchanged, and set them `False` in the IP `.env`.

## 3. Chosen approach — on-box image build (Approach A)

Build the backend and frontend images directly on the VPS rather than pulling from GHCR. Rationale:

- No GHCR token or GitHub Actions secrets needed for a first bring-up.
- The frontend's `NEXT_PUBLIC_*` values are inlined at build time; building on-box lets us bake `http://200.97.165.67/...` in directly.
- Fits the deferred-CI/CD decision. The GHCR/Actions path (Approach B) is adopted later at domain cutover, unchanged.

Build cost on the 2 vCPU / 8 GB box (with the 2 GB swap that `server-init.sh` configures) is a few minutes — acceptable.

## 4. New / changed artifacts

The prod path (`docker-compose.prod.yml`, `nginx.production.conf`, CI workflow) stays **untouched** so the later domain cutover is a clean switch-back. New work lives in additive files:

| Artifact | Type | Purpose |
|---|---|---|
| `infra/nginx/nginx.ip.conf` | new | HTTP-only, port 80, path-based reverse proxy |
| `docker-compose.ip.yml` | new | Override on `docker-compose.prod.yml`: `build:` contexts for backend/frontend, mount `nginx.ip.conf`, drop `certbot`, publish port 80 |
| `config/settings/production.py` | edit (4 lines) | `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, HSTS → `env.bool(..., default=True)` |
| `infra/scripts/deploy-ip.sh` | new | Build + up + wait-healthy on the box (thin wrapper mirroring `deploy.sh`) |
| `.env` (on server only) | new, **uncommitted** | Filled from `.env.production.example` with HTTP/IP values |

### 4.1 `nginx.ip.conf` routing (single host, port 80)

- `location /` → `frontend:3000`
- `location /api/` → `backend:8000`
- `location /ws/` → `backend:8000` (WebSocket upgrade)
- `location /static/` → shared `static_files` volume (Django admin/DRF assets)
- `location /media/` → `minio:9000`

Keep the existing per-IP rate-limit zones (`api`, `auth`) and gzip. Drop all `ssl_*` directives, HSTS, and the HTTP→HTTPS redirect block.

### 4.2 `.env` values that differ from production

- `ALLOWED_HOSTS=200.97.165.67`
- `CSRF_TRUSTED_ORIGINS=http://200.97.165.67`
- `NEXT_PUBLIC_API_URL=http://200.97.165.67/api`
- `NEXT_PUBLIC_WS_URL=ws://200.97.165.67/ws`
- `NEXT_PUBLIC_MINIO_URL=http://200.97.165.67/media`
- `SECURE_SSL_REDIRECT=False`, `SESSION_COOKIE_SECURE=False`, `CSRF_COOKIE_SECURE=False`, `SECURE_HSTS_SECONDS=0`
- Freshly generated secrets: Django `SECRET_KEY`, `TENANT_CRED_ENCRYPTION_KEY` (Fernet), and DB / Redis / MinIO passwords.

## 5. Go-live sequence

1. **Bootstrap (as root):** run `infra/scripts/server-init.sh` — installs Docker + compose, creates the `deploy` user, applies UFW/Fail2Ban/SSH hardening and a 2 GB swap. Ensure UFW allows **22** and **80**.
2. **Get code on box:** clone the repo into `/home/deploy/repairos` as the `deploy` user. Private repo → provision a read-only deploy key or PAT.
3. **Configure `.env`:** copy `.env.production.example` → `.env`, fill secrets and the HTTP/IP values from §4.2.
4. **Build + start:** `docker compose -f docker-compose.prod.yml -f docker-compose.ip.yml up -d --build`. The backend entrypoint runs migrations + collectstatic automatically.
5. **Seed:** create the platform-admin account and provision the first tenant (via the project's management commands / seed script).
6. **Smoke-test:** load `http://200.97.165.67`, log in at `/admin/login`, and drive one real flow through the UI (not via API).

## 6. Risks & known issues to watch

- **`create_tenant` autocommit desync** — first-tenant provisioning is exactly where this previously failed silently (master-DB writes lost, tenant stuck in "provisioning"). **Verify it is resolved on `master` before seeding.**
- **pgbouncer stale pidfile** — known crash-loop on container restart; recovery step (remove stale pidfile) ready if it recurs.
- **PWA/service worker** does not register over HTTP — expected; deferred with TLS.
- **`X-Tenant-Slug` stale-default** — do not delete the first/default tenant; `apiFetch()` sends the default slug on public endpoints.
- **On-box build memory** — Next.js production build is memory-hungry; the 2 GB swap covers it, but watch for OOM on first build.

## 7. Deferred: "domain cutover" session

When the domain and DNS are ready:

1. Point DNS (`app.`, `*.api.`, `media.`, apex) at `200.97.165.67`.
2. Issue Let's Encrypt certs via the certbot webroot; switch nginx back to `nginx.production.conf`.
3. Flip the four `SECURE_*` flags back to `True` (unset the env overrides) and update `NEXT_PUBLIC_*` + `ALLOWED_HOSTS` to the HTTPS domain; rebuild the frontend.
4. Re-enable the PWA.
5. Wire GitHub Actions secrets (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_SSH_PORT`, `VPS_DEPLOY_DIR`, `GHCR_USER`, `GHCR_TOKEN`) and `NEXT_PUBLIC_*` repo vars, moving to the GHCR/Actions deploy path (Approach B) for one-click deploys.

## 8. Security note

The SSH target (`root@200.97.165.67`) is known; no private key is stored in the repo or this spec. Server access is performed interactively by the user or with a key the user supplies at execution time. `server-init.sh` disables password SSH and sets up Fail2Ban/UFW as part of step 1.
