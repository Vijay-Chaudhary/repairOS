# Foundation 02 — Authentication & RBAC

> JWT design, the users/roles/permissions schema, seeded system roles, and the full permission catalogue. Every module's permission checks resolve against this.

---

## 1. JWT design (tenant-aware)

Every JWT carries `tenant_slug`; `TenantMiddleware` reads it to pick the tenant DB. Platform-admin tokens (`is_platform_admin=true`) connect only to the master DB.

| Token | Claims | Expiry | Storage |
|---|---|---|---|
| Access | user_id, tenant_slug, shop_ids[], role_ids[], permissions[], is_platform_admin, exp | 15 min | client **memory only** (not localStorage — XSS) |
| Refresh | user_id, tenant_slug, token_family, exp | 30 days | **HttpOnly Secure SameSite=Strict** cookie |

Refresh rotation with **token-family replay detection**: reusing a rotated refresh token revokes the whole family (all sessions for that user).

---

## 2. Schema (tenant DB)

> 🔧 **PROPOSED:** `users.employee_id` removed; the User↔Employee link is one-directional via `employees.user_id` (see `09-hr-payroll`). Soft-delete columns added to `users` and `roles`.

### 2.1 `users`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| email | VARCHAR(200) | UNIQUE NOT NULL |
| phone | VARCHAR(20) | UNIQUE NOT NULL — `+91XXXXXXXXXX` normalized |
| password_hash | VARCHAR(256) | bcrypt cost 12 |
| full_name | VARCHAR(200) | NOT NULL |
| is_active | BOOLEAN | DEFAULT TRUE |
| last_login | TIMESTAMP | NULL |
| failed_login_attempts | INTEGER | DEFAULT 0 |
| locked_until | TIMESTAMP | NULL — NOW()+15 min after 5 failures |
| avatar_url | VARCHAR(500) | NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |
| deleted_at / deleted_by | TIMESTAMP / UUID | NULL — "delete user" = soft (deactivate) |

### 2.2 `roles`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| name | VARCHAR(100) | NOT NULL |
| description | TEXT | NULL |
| is_system_role | BOOLEAN | DEFAULT FALSE — system roles cannot be edited/deleted |
| deleted_at | TIMESTAMP | NULL |

### 2.3 `permissions`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| codename | VARCHAR(100) | UNIQUE — e.g. `repair.jobs.create` |
| module | VARCHAR(50) | crm/repair/pos/erp/amc/billing/hr/reports/settings |
| label | VARCHAR(200) | role-builder UI label |
| description | TEXT | NULL |

### 2.4 `role_permissions` (composite PK)
`role_id` FK→roles, `permission_id` FK→permissions.

### 2.5 `user_roles`
`id` PK; `user_id` FK; `role_id` FK; `shop_id` FK NULL (NULL = tenant-wide).

### 2.6 `user_shop_access` (composite PK)
`user_id` FK, `shop_id` FK — which shops a user may access.

### 2.7 `audit_logs`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK NULL |
| action | VARCHAR(20) | create/update/delete/login/logout/permission_denied |
| model_name | VARCHAR(100) | e.g. JobTicket, Sale |
| object_id | UUID | affected record |
| old_value / new_value | JSONB | NULL on create / delete |
| ip_address | INET | |
| user_agent | TEXT | |
| created_at | TIMESTAMP | DEFAULT NOW() INDEXED |

Every sensitive write (all modules) appends here.

---

## 3. Auth API

| Endpoint | Body | Success | Errors |
|---|---|---|---|
| POST `/auth/login/` | `{email,password}` | 200 `{access_token, user{id,name,permissions[]}}` | 400 INVALID_CREDENTIALS, 423 ACCOUNT_LOCKED |
| POST `/auth/otp/request/` | `{phone}` | 200 `{message, expires_in:600}` | 400 INVALID_PHONE, 429 OTP_RATE_LIMIT |
| POST `/auth/otp/verify/` | `{phone,otp}` | 200 `{access_token, user{…}}` | 400 INVALID_OTP, 410 OTP_EXPIRED |
| POST `/auth/token/refresh/` | (HttpOnly cookie) | 200 `{access_token}` | 401 REFRESH_TOKEN_INVALID / REFRESH_TOKEN_REUSE |
| POST `/auth/logout/` | `{}` | 200 | 401 NOT_AUTHENTICATED |
| POST `/auth/password/change/` | `{old_password,new_password}` | 200 | 400 WRONG_PASSWORD / PASSWORD_TOO_WEAK |

Password policy: min 8 chars, ≥1 upper, ≥1 number, ≥1 special.

---

## 4. System roles (seeded per tenant DB at provisioning)

| Role | Scope | Key permissions |
|---|---|---|
| Tenant Admin | all shops | all modules; cannot delete own account |
| Shop Manager | assigned shop(s) | jobs, CRM, POS, inventory, HR, reports for those shops |
| Receptionist | assigned shop | create customers/jobs, log comms; no billing write |
| Technician | assigned shop | view/update own jobs+stages, request parts, view own commission |
| Billing Staff | assigned shop | invoices, payments, POS, financial reports |
| HR Manager | tenant-wide | attendance, leave, salary, employees; no job/sales |
| Viewer | assigned shop | read-only; no write |

Custom roles (Professional+ plans) built from the permission catalogue below.

---

## 5. Permission catalogue

| Module | Codenames |
|---|---|
| crm | leads.view, leads.create, leads.edit, leads.convert, customers.view, customers.create, customers.edit, customers.merge, communications.log, tasks.manage, segments.manage |
| repair | jobs.view, jobs.create, jobs.edit, jobs.change_status, jobs.assign_tech, estimates.send, estimates.approve, templates.manage, warranty.view, spare_parts.request, spare_parts.approve |
| pos | counter_sale.create, wholesale_sale.create, job_sale.create, discount.apply, returns.create, returns.approve |
| erp | inventory.view, inventory.adjust, suppliers.manage, purchase_orders.create, grn.receive, purchase_invoices.record, purchase_returns.create, expenses.view, expenses.create, budget.manage, assets.manage |
| amc | contracts.view, contracts.create, contracts.edit, visits.schedule, visits.complete, renewals.manage |
| hr | employees.view, employees.manage, attendance.view, attendance.mark, leaves.manage, salary.view, salary.generate, petty_cash.manage |
| billing | repair_invoices.view, repair_invoices.create, sales_invoices.view, payments.record, outstanding.view, tally_export |
| reports | revenue.view, hr.view, crm.view, repair.view, inventory.view, gst.view, pl.view |
| settings | shop.edit, roles.manage, users.manage, commission_rules.manage, notifications.manage |

(Each codename is prefixed by its module, e.g. `crm.leads.view`.)

---

## 6. User management endpoints

| Endpoint | Method | Perm | Description |
|---|---|---|---|
| `/users/` | GET / POST | settings.users.manage | list / create |
| `/users/{id}/` | PATCH / DELETE | settings.users.manage | update / soft-deactivate |
| `/users/{id}/force-logout/` | POST | settings.users.manage | revoke all sessions |
| `/roles/` | GET / POST | settings.roles.manage | list / create custom |
| `/roles/{id}/` | PATCH / DELETE | settings.roles.manage | update perms / delete (custom only) |

---

## 7. Tests
- bcrypt cost, lockout after 5 fails, refresh rotation + replay revocation.
- Permission denial returns `403 PERMISSION_DENIED` and writes `permission_denied` audit row.
- System roles immutable (edit/delete → 403).
- Isolation: a user in Tenant A cannot authenticate against Tenant B (see architecture §11).
