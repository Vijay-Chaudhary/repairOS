# Module 12 — Platform Admin (Master DB, Subscriptions, Onboarding)

> The platform side: master database, tenant registry, subscription plans, the tenant lifecycle, and the signup/onboarding flow. This is the only module that operates on the **master database**.

## 1. Purpose & scope
Everything that lives outside any single tenant: the tenant registry and routing credentials, subscription plans + billing, platform-admin accounts, the master audit log, the provisioning trigger, and the new-tenant onboarding wizard. **Out of scope:** any business data (that's per-tenant). The provisioning *mechanism* is in `foundation/01-architecture` §4; this module owns the *data and admin surface* around it.

## 2. Dependencies
foundation 01 (provisioning flow, routing). Platform-admin JWTs (`is_platform_admin=true`) connect only to the master DB. Triggers tenant-DB creation + seeding.

## 3. Data model — MASTER DATABASE only

### 3.1 `tenants`
id (UUID), name, slug (UNIQUE, sanitised lowercase a-z/0-9/_), plan_id FK, is_active, trial_ends_at NULL, settings JSONB, logo_url (`/{slug}/logo.png`), created_at, updated_at.

### 3.2 `tenant_databases`
id, tenant_id FK UNIQUE, db_name (`repaiross_tenant_{slug}`), db_host, db_port DEFAULT 5432, db_user (`repaiross_{slug}_user`), `db_password_encrypted` (AES-256/KMS), db_status (provisioning/active/suspended/deleted), provisioned_at, last_migration_at, max_connections DEFAULT 5.

### 3.3 `subscription_plans`
id, name (Starter/Professional/Enterprise), max_shops, max_users, max_products, max_jobs_per_month (NULL=unlimited), features JSONB (`{"pos":true,"amc":true,...}`), price_monthly_inr.

### 3.4 `tenant_subscriptions`
id, tenant_id FK, plan_id FK, status (active/trialing/past_due/cancelled/paused), current_period_start, current_period_end, razorpay_subscription_id NULL.

### 3.5 `platform_admins`
id, email UNIQUE, password_hash (bcrypt 12), full_name, is_active, last_login.

### 3.6 `audit_log_master`
id, event_type (tenant.created/tenant.suspended/provisioning.failed/…), tenant_id FK NULL, actor_id FK→platform_admins NULL, payload JSONB, created_at INDEXED.

## 4. Business rules

### 4.1 Plan matrix (feature flags drive per-tenant capabilities)
| Feature | Starter | Professional | Enterprise |
|---|---|---|---|
| Shops / Users / Jobs-mo / Products | 1 / 5 / 200 / 200 | 5 / 25 / 1,000 / 5,000 | ∞ |
| Dedicated database | Yes | Yes | Yes |
| CRM (leads, tasks, timeline) | Yes | Yes | Yes |
| Customer segmentation | No | Yes | Yes |
| Repair estimates & approval | Yes | Yes | Yes |
| Multi-stage repair | No | Yes | Yes |
| Fault templates / Warranty / Spare parts | Yes | Yes | Yes |
| POS counter | Yes | Yes | Yes |
| POS wholesale | No | Yes | Yes |
| AMC | No | Yes | Yes |
| HR / Petty cash / Assets / Budget | No | Yes | Yes |
| WhatsApp / Google Maps / Tally export | No | Yes | Yes |
| Custom roles | No | Yes | Yes |
| Barcode scanning | Yes | Yes | Yes |
| Inter-shop transfer | No | Yes | Yes |
| Max DB connections | 3 | 5 | 10 (custom) |
| API access | No | No | Yes |
| Support | — | Email 48h | Phone+Email 4h |
| Price (INR/mo) | ₹999 | ₹2,999 | Custom |

Feature flags are read from `subscription_plans.features` and enforced in the app layer per tenant.

### 4.2 Tenant lifecycle
provisioning → active → (suspended for non-payment / cancelled). Suspension blocks logins (`PROVISIONING_IN_PROGRESS`/`TENANT_DB_UNAVAILABLE` semantics differ — suspended returns an auth-level block). 🔧 PROPOSED data-retention on cancellation (OQ-02): grace period → export window → deletion; define before launch.

### 4.3 Onboarding
**Registration & auto-provision:** visit `/register` → business name, slug (auto-suggested, validated), owner name, phone, email, password → slug uniqueness vs master → email verify + phone OTP (both required) → provisioning flow (foundation/01 §4, <5 s) → "Setting up your workspace…" → redirect to wizard.

**Wizard (5 mandatory steps, cannot dismiss):**
1. Shop setup — name, city, state (GST), GSTIN, phone; shop code auto-generated (editable).
2. Branding — logo, invoice footer note, NEFT bank details.
3. Invite staff — first staff member (skippable).
4. Commission rules — default rate (30%), lead tech share (50%).
5. WhatsApp — connect WhatsApp Business number, test message.
Completion → dashboard with "Create Your First Job" CTA. **Target: first job within 10 minutes of email verification.**

## 5. Permissions
Platform-admin-only surface (separate from tenant RBAC). Tenant Admins manage their own subscription view but not other tenants.

## 6. API (master-scoped, platform admin)
| Endpoint | Method | Notes |
|---|---|---|
| `/register/` | POST | creates tenant + triggers provisioning |
| `/platform/tenants/` | GET | list tenants (platform admin) |
| `/platform/tenants/{id}/suspend/` | POST | suspend (non-payment) |
| `/platform/tenants/{id}/` | GET | tenant + db_status + subscription |
| `/platform/plans/` | GET/POST | plan management |
| `/webhooks/razorpay/` (subscription events) | POST | subscription status sync |

```jsonc
// POST /register/  { "business_name":"Joy Computer","slug":"joycomputer",
//   "owner_name":"…","phone":"+91…","email":"…","password":"…" }
// 201 { "tenant_id":"…","db_status":"provisioning" }  → poll until active
```

## 7. Real-time events
`tenant.db_provisioned { tenant_slug, shop_count }` → **Platform Admin only (master channel)**.

## 8. Notifications
Welcome email + WhatsApp on provisioning complete (foundation/01 §4 step 13).

## 9. Reports
Platform-level only, from master DB aggregates (tenant count, MRR, provisioning times). No cross-tenant business data.

## 10. Acceptance criteria
- [ ] Provisioning completes < 5 s and seeds roles + Tenant Admin.
- [ ] Failure path: status `provisioning_failed`, alert, cleanup, re-triggerable.
- [ ] Plan feature flags enforced per tenant in the app layer.
- [ ] Wizard cannot be skipped; minimum config in place before first use.
- [ ] Platform admin cannot read tenant business data (only master).

## 11. Tests
Signup + provisioning E2E (DB created, migrated, seeded, wizard, first job). `migrate_all_tenants` across 10 DBs. Suspended tenant blocked from login. Master-only isolation: platform admin token cannot reach any tenant DB.

## 12. Open questions
OQ-01 (Razorpay account model), OQ-02 (data retention on cancellation), OQ-03 (>1000 tenants: RDS-per-tenant / Aurora Serverless / schema-per-tenant overflow).
