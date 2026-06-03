# Foundation 01 — Architecture

> Read this before any module. It defines the database-per-tenant model, how requests reach the right database, how tenants are provisioned, how migrations run, the tech stack, non-functional targets, deployment, and the locked architecture decisions.

---

## 1. Philosophy

RepairOS uses **database-per-tenant** isolation. Every tenant that signs up gets a dedicated PostgreSQL database, provisioned automatically in seconds. Tenant databases share one AWS RDS instance but are isolated at the database level — one tenant's credentials cannot touch another's, enforced by PostgreSQL `GRANT`/`REVOKE`, not just the app layer.

A central **master database** (`repaiross_master`) holds only platform data: tenant registry, connection credentials, subscriptions, platform admins. It never holds business data.

> **Non-negotiable isolation rule.** No ORM query, raw SQL, or background task may touch a tenant's database unless the request context is authenticated and `TenantDatabaseRouter` has switched to that tenant's connection. Cross-tenant queries are architecturally impossible — each tenant DB user's credentials grant access only to that one DB.

**No `tenant_id` column anywhere in tenant databases.** The connection *is* the tenant context. This kills the most common multi-tenant data-leak bug class. Shop-level isolation within a tenant DB uses `shop_id` foreign-key checks in the application layer.

---

## 2. Database naming

| Database | Pattern | Example |
|---|---|---|
| Master | `repaiross_master` | `repaiross_master` |
| Tenant | `repaiross_tenant_{slug}` | `repaiross_tenant_joycomputer` |
| Tenant DB user | `repaiross_{slug}_user` | granted ALL on that DB only |

Slug: lowercase `a-z`, `0-9`, underscore only, 3–50 chars. Credentials stored AES-256-encrypted (AWS KMS) in `master.tenant_databases.db_password_encrypted`.

---

## 3. Shared tenant tables (used by every module)

These live in every tenant DB and are referenced throughout the modules.

### 3.1 `shops`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| name | VARCHAR(200) | NOT NULL |
| code | VARCHAR(10) | UNIQUE NOT NULL — prefixes job/invoice/PO numbers, e.g. HTA |
| address | TEXT | NOT NULL |
| city | VARCHAR(100) | NOT NULL |
| state | VARCHAR(100) | NOT NULL — drives CGST/SGST vs IGST |
| state_code | VARCHAR(2) | NOT NULL — GST state code, e.g. 09 = UP |
| phone | VARCHAR(20) | NOT NULL |
| email | VARCHAR(200) | NULL |
| gstin | VARCHAR(15) | NULL — 15-char validated |
| lat / lng | DECIMAL | NULL |
| is_active | BOOLEAN | DEFAULT TRUE |
| working_hours | JSONB | `{"mon":{"open":"09:00","close":"19:00"},...}` |
| created_at / updated_at | TIMESTAMP | |

(`users`, `roles`, `permissions` → `foundation/02-auth-rbac`.)

---

## 4. Provisioning flow (signup, target < 5 s)

Runs synchronously at signup:

1. Validate signup form; check slug uniqueness in `master.tenants`.
2. Create `tenants` record, status `provisioning`.
3. Generate creds: `db_name`, `db_user`, 32-char random password.
4. `CREATE DATABASE repaiross_tenant_{slug} ENCODING 'UTF8' ...`
5. `CREATE USER repaiross_{slug}_user WITH PASSWORD '…';`
6. `GRANT ALL PRIVILEGES ON DATABASE … TO …;`
7. `REVOKE ALL ON DATABASE … FROM PUBLIC;`
8. Store encrypted creds in `tenant_databases`, status `active`.
9. `migrate_tenant(slug)` — apply all migrations to the new DB.
10. Create initial Tenant Admin user in the tenant DB.
11. Seed system roles + permissions in the tenant DB.
12. Set master tenant status `active`.
13. Welcome email + WhatsApp; redirect to onboarding wizard.

**Failure handling:** Celery retries 3× (10/30/90 s). All fail → status `provisioning_failed`, PagerDuty alert, "setting up your account" page. Partial DB/user dropped (no orphans). Re-triggerable (idempotent).

---

## 5. Request routing

### 5.1 `TenantDatabaseRouter`
`DATABASE_ROUTERS = ['core.routers.TenantDatabaseRouter']`.

| Method | Behaviour |
|---|---|
| `db_for_read` / `db_for_write` | master_app models → `'default'`; else → `get_tenant_db_alias()` from context |
| `allow_relation` | only if both objects on same DB (blocks cross-DB joins) |
| `allow_migrate` | `'default'` → only master_app; tenant aliases → all non-master apps |

### 5.2 `TenantMiddleware` (every request, before views)
1. Extract + validate JWT from `Authorization: Bearer`.
2. Read `tenant_slug` claim.
3. Look up creds in Redis cache (TTL 5 min), fallback master DB.
4. Build alias `tenant_{slug}`; add to `django.db.connections` if absent (decrypted creds).
5. Store alias in context (see 5.3).
6. After response: clear context, return connection to pool.

### 5.3 Context storage — **mandatory rule**
- **WSGI (sync):** `threading.local()`.
- **ASGI / Django Channels (async):** `contextvars.ContextVar`. Thread-local is unsafe in async — the router must use the async-safe variant for WebSocket code paths.

### 5.4 Connection pooling (PgBouncer)
| Aspect | Decision |
|---|---|
| Mode | Transaction-mode, per RDS instance |
| Max conn / tenant DB | 5 (configurable per plan) |
| Global | RDS 500; PgBouncer 400; master 20 |
| New pool | Added via PgBouncer admin API + config reload at provisioning (no restart) |
| Idle timeout | 30 s per tenant connection |
| Cred cache | Redis, TTL 5 min |

### 5.5 `DATABASES` config
Starts with only `default` (master). `TenantMiddleware` adds tenant entries at runtime:
```python
DATABASES = { "default": {  # master
  "ENGINE": "django.db.backends.postgresql", "NAME": "repaiross_master",
  "HOST": os.environ["MASTER_DB_HOST"], "USER": "repaiross_master_user",
  "PASSWORD": secrets_manager.get("master-db-password"), "PORT": "5432",
  "CONN_MAX_AGE": 60 } }
# runtime: connections.databases["tenant_{slug}"] = { ...decrypted..., "CONN_MAX_AGE": 30 }
```

---

## 6. Migrations — two tracks

| Track | Target | Command | When |
|---|---|---|---|
| Master | `repaiross_master` | `migrate --database=default` | Deploy step 1 |
| Tenant | all active tenant DBs | `migrate_all_tenants` | Deploy step 2 |

**`migrate_all_tenants`:** query active tenants → add connection → `call_command('migrate', database='tenant_{slug}')` → log per-tenant to `audit_log_master`. On failure: log + continue (don't abort); PagerDuty if >5% fail. **Parallel** via multiprocessing, max 10 workers; 100 tenants target < 60 s. New tenant DB migrated synchronously inside provisioning (step 9); `migrate_tenant(slug)` idempotent.

---

## 7. Technology stack

| Layer | Tech | Version | Purpose |
|---|---|---|---|
| Frontend | Next.js (App Router) | 14 LTS | SSR, PWA, routing, POS |
| State | Zustand + TanStack Query | latest | UI state + server cache |
| UI | shadcn/ui + Tailwind | latest | components |
| Backend | Django | 5.1.x | ORM, middleware, multi-DB routing |
| API | Django REST Framework | 3.15+ | viewsets, serializers, throttling |
| Real-time | Channels (ASGI, Daphne) | 4.x | WebSocket — uses ContextVar |
| Auth | drf-simplejwt | 5.x | JWT w/ tenant_slug, refresh rotation |
| Tasks | Celery | 5.x | PDFs, WhatsApp, reports, payroll, AMC, provisioning |
| Broker | Redis | 7.x | Celery + Channels + cred cache |
| DB | PostgreSQL 16 (AWS RDS) | 16.x | master + tenant DBs, same instance |
| Pool | PgBouncer | 1.22+ | transaction-mode, dynamic per-tenant |
| Files | S3 + CloudFront | — | path-prefixed `/{slug}/...` |
| PDF | WeasyPrint | 62+ | GST invoice PDFs |
| Barcode | ZXing-js | 3.x | POS camera scan |
| Email / SMS-OTP | AWS SES / MSG91 | — | transactional / OTP + WA fallback |
| Containers / Orch | Docker / EKS | 24+ / 1.29+ | |
| CI/CD | GitHub Actions | — | incl. tenant migration step |
| Secrets | Secrets Manager + KMS | — | KMS-encrypted DB passwords |
| Obs | Sentry / Prometheus+Grafana / OpenSearch | — | per-tenant tags on errors/metrics/logs |

---

## 8. Non-functional requirements

### 8.1 Performance
| Metric | Target |
|---|---|
| API p50 / p95 / p99 | <100 ms / <300 ms / <800 ms |
| Provisioning (signup) | < 5 s |
| `migrate_all_tenants` (100) | < 60 s |
| POS sale e2e | < 1 s |
| Invoice PDF | < 3 s |
| Dashboard LCP | < 2.5 s |
| Concurrent / tenant | 50 |
| Concurrent platform | 500 |
| Conn / tenant DB | max 5 (PgBouncer) |

### 8.2 Security
| Area | Spec |
|---|---|
| Tenant creds | AES-256 / KMS, decrypt in memory only, never logged |
| Transport | TLS 1.3 min, HSTS 1 yr |
| At rest | RDS TDE, S3 SSE, Redis AOF encrypted |
| Column encryption | bank acct, PAN, Aadhar via Django Encrypted Fields (AES-256) |
| DB isolation | per-tenant user grants + REVOKE FROM PUBLIC, verified in CI |
| Auth | bcrypt cost 12; JWT 15 min; refresh rotation + family replay detection |
| OWASP | ORM (no raw SQL); DRF/Next escaping; double-submit CSRF; shop_id IDOR checks |
| Rate limit | 100 req/min/user; 20 req/min/IP unauth; 3 OTP/phone/10 min |
| Secrets | Secrets Manager, zero secrets in code/env/images, KMS rotate quarterly |
| Webhooks | Razorpay HMAC-SHA256; WhatsApp X-Hub-Signature-256; fail → 403 |
| VAPT | full pentest pre-launch; quarterly Burp CI; HIGH/CRITICAL blocks deploy |

### 8.3 Availability & DR
| Metric | Target | How |
|---|---|---|
| Uptime | 99.5%/mo | multi-pod K8s + RDS Multi-AZ + ALB health |
| RTO | < 30 min | Patroni failover + pod restart |
| RPO | < 5 min | streaming replication, sync commit |
| Tenant blast radius | one DB failure ≠ others | separate DB/pool/Sentry issue |
| Backup | daily snapshots + WAL | 30-day retention, PITR to 5-min window |
| Maintenance | Sun 02–04 IST rolling | banner 48 h prior, online DDL only |

### 8.4 Scalability
Stateless Django pods, HPA on CPU>70% max 20. Max 5 conn/tenant DB. 1,000 tenant DBs on one `db.t3.large` (load-tested pre-launch). S3 path-prefix per tenant (no per-bucket overhead). Celery pools per priority.

---

## 9. Deployment

### 9.1 Environments
| Env | Trigger | DB |
|---|---|---|
| local | `docker-compose up` | local PG: master + 2 seed tenants |
| staging | auto on merge to `develop` | isolated RDS |
| production | manual gate post-staging | RDS Multi-AZ |

### 9.2 CI/CD pipeline (fail-fast)
1 Code quality (ruff/ESLint/black) → 2 Security scan (pip-audit/npm audit, HIGH/CRIT blocks) → 3 Backend tests (pytest --cov incl. isolation; <85% fails) → 4 Frontend tests (jest; <70% fails) → 5 Build images → 6 Push to ECR → 7 Master migrations (staging) → 8 `migrate_all_tenants` (>5% fail blocks) → 9 Deploy staging → 10 Playwright E2E → 11 Manual gate (PO, 48 h) → 12 Deploy prod (zero-downtime, auto-rollback on health fail) → 13 Post-deploy smoke + Sentry release marker.

### 9.3 Infrastructure
EKS 1.29+ (t3.medium ×3→×10). Django min 2 / HPA 20. Next.js min 2 / HPA 10. Celery pools: high (notif/PDF) 1–5, medium (reports/payroll) 1–5, low (bulk/migrate) 1–3. RDS db.t3.large Multi-AZ. PgBouncer sidecar per Django pod. ElastiCache t3.medium. ALB + WAF + SSL, health `/api/v1/health/` /10 s. S3 `repaiross-files-prod` prefix `/{slug}/...`. Route 53 `*.repaiross.app` (ACM). Prometheus/Grafana (per-tenant conn dashboard), Sentry (`tenant_slug` tag), OpenSearch (`tenant_slug` per line, 30-day hot / 90-day cold).

---

## 10. Locked architecture decisions

| ID | Decision | Rationale |
|---|---|---|
| AD-01 | DB-per-tenant (shared RDS) | Strongest isolation, cost-effective vs per-instance |
| AD-02 | Auto-provision at signup (<5 s) | Immediate access; manual = signup drop-off |
| AD-03 | PgBouncer dynamic pool per tenant DB | Prevents one tenant exhausting RDS conns |
| AD-04 | `migrate_all_tenants` multiprocessing | 100 tenants <60 s vs 10+ min sequential |
| AD-05 | No `tenant_id` columns | Isolation via connection; kills join-bug class |
| AD-06 | JWT `tenant_slug` for routing | Stateless, no session store |
| AD-07 | Thread-local (WSGI) / ContextVar (ASGI) | Async-safety in Channels |
| AD-08 | S3 path-prefix not per-bucket | S3 100-bucket limit; prefixes unlimited |
| AD-09 | Repair vs sales invoices separate tables | Different GST (SAC vs HSN), sequences, line types |
| AD-10 | Commission base: SC only | Labor compensation; product margin is shop P&L |
| AD-11 | PWA only (no native in v3.1) | Single codebase, full Android via PWA |
| AD-12 | AMC renewal reuses repair_invoice | Maintenance is a service (SAC); same infra, different template |

---

## 11. Global tenant-isolation test suite (every PR)

- Tenant A user → list any resource → only Tenant A rows, zero Tenant B.
- Direct query Tenant A connection for Tenant B data → denied at PostgreSQL level.
- Crafted JWT: Tenant B slug + Tenant A user_id → middleware switches to B → user not found → 401.
- All 12 modules covered. Zero cross-tenant leakage is a release blocker.
