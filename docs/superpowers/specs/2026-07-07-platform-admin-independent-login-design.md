# Platform Admin — Independent Login — Design

**Date:** 2026-07-07
**Status:** Approved (brainstormed with Vijay)

## Why

Platform admin (`platform@repaiross.app`) is currently just a row in the `demo` tenant's own
database with `is_platform_admin=True` flipped on. Every `User` — tenant staff and platform admin
alike — lives in a tenant DB; there is no user table in the master (`default`) DB at all.

Logging in as platform admin therefore requires supplying the `demo` tenant's workspace slug on
the normal `/login` page, so `TenantMiddleware` can resolve which tenant DB to even query the
email against. This accidentally couples the platform admin identity to whichever tenant happens
to house it — if `demo` were ever deleted or suspended, platform admin login breaks — and it's
conceptually wrong: platform admin is not a tenant.

This design makes platform admin a genuinely independent account, stored in the master DB, with
its own login page and its own backend auth stack, decoupled entirely from any tenant.

## Decisions (locked during brainstorming)

- Platform admin identity moves to a **new model in the master DB**, not a reserved tenant and not
  Django's built-in auth/admin.
- **Separate route + endpoint**: `/admin/login` on the frontend, `POST /api/v1/platform/auth/login/`
  on the backend. The existing tenant-scoped `/login` page and its endpoint are untouched.
- **Provisioning is management-command only** (`create_platform_admin`) — no public signup, no
  admin-invites-admin UI. Matches how `create_tenant` already works.
- The existing `platform@repaiross.app` row in the `demo` tenant DB is **retired**, not migrated —
  a fresh admin is created in the master DB via the new command.
- The `is_platform_admin=True` bypass currently scattered across ~20 tenant-app RBAC checks
  (CRM/HR/billing/inventory/pos/repair) — granting a *tenant-scoped* JWT unrestricted access — is
  **incidental, not a real feature**, and is explicitly out of scope. It's not removed in this
  pass (see §5), but no replacement ("impersonate tenant") is being built either.
- Platform admin gets the **same lockout + audit-log protections** tenant users get
  (`failed_login_attempts` / `locked_until`, login/logout audit trail), mirrored into the master
  DB rather than reused cross-DB.

---

## 1. Data model (master DB)

New models in the `master` app, all living on the `default` (master) DB — never a tenant DB:

```python
class PlatformAdminUser(AbstractBaseUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)
    failed_login_attempts = models.IntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    USERNAME_FIELD = "email"

    @property
    def is_locked(self) -> bool:
        return self.locked_until is not None and timezone.now() < self.locked_until
```

- Subclasses `AbstractBaseUser` (same as tenant `authentication.User`) purely for `set_password`/
  `check_password`/password hashing — it is **not** `AUTH_USER_MODEL` and does not participate in
  `django.contrib.auth` backends.
- No RBAC, no roles, no shops. A platform admin is a flat superuser over `/platform/*`. Per-admin
  permission levels are a separate future spec if ever needed.

```python
class PlatformAdminTokenFamily(models.Model):
    admin = models.ForeignKey(PlatformAdminUser, on_delete=models.CASCADE, related_name="token_families")
    family_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    is_revoked = models.BooleanField(default=False, db_index=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    current_jti = models.CharField(max_length=255, unique=True)
```

Mirrors `authentication.UserTokenFamily` for refresh-token replay detection, FK'd to
`PlatformAdminUser` instead.

```python
class PlatformAdminAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    admin_id = models.UUIDField(null=True, blank=True, db_index=True)
    action = models.CharField(max_length=20)  # login / logout / password_change
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
```

Minimal, separate table from tenant `authentication.AuditLog` (different DB entirely — cannot be
shared).

---

## 2. Auth flow & tokens (backend)

New endpoints in `apps/master`, `AllowAny` at the view level (auth happens inside the view, same
pattern as the existing tenant `LoginView`):

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/platform/auth/login/` | email+password against `PlatformAdminUser` (master DB only) |
| `POST /api/v1/platform/auth/token/refresh/` | reads platform refresh cookie, validates against `PlatformAdminTokenFamily`, rotates |
| `POST /api/v1/platform/auth/logout/` | revokes the family, clears the platform cookie |
| `GET /api/v1/platform/auth/me/` | returns the platform admin's own profile |

These are a **fully separate, self-contained stack**, not branches inside the existing tenant auth
views. This is necessary, not just cleaner: `TokenRefreshView`/`MeView`/`LogoutView` all resolve
`request.user`/`user_id` against tenant `authentication.User` in whatever tenant DB happens to be
routed — a platform admin token will never have a tenant DB routed, so those views cannot be
reused for it.

Details:

- **Lockout**: same pattern as tenant login — `failed_login_attempts` increments on bad password,
  `locked_until` set after `AUTH_MAX_FAILED_ATTEMPTS`, reset on success.
- **Refresh cookie**: HttpOnly, but a **different cookie name** (`platform_refresh_token`) and a
  **different path** (`/api/v1/platform/auth/`) than the tenant refresh cookie
  (`refresh_token` @ `/api/v1/auth/`) — so a platform-admin session and a tenant session can never
  collide or be confused in the same browser.
- **JWT claims**: `admin_id`, `token_type: "platform_admin"`, `is_platform_admin: true`. The
  `is_platform_admin` claim name is kept as-is for backward compatibility with the existing
  `IsPlatformAdmin` permission class in `master/views.py`, which only reads that one claim.
  Crucially, **no `tenant_slug` claim is ever issued**.
- **`PlatformAdminJWTAuthentication`**: a new authentication class (parallel to
  `authentication.tokens.TenantJWTAuthentication`) that resolves `request.user` against
  `PlatformAdminUser` in the master DB, not tenant `authentication.User`. Set as the
  `authentication_classes` on `/platform/*` views only (via `apps/master/views.py`) — nothing
  outside the `master` app changes.
- **TenantMiddleware**: no changes needed. Because the token never carries `tenant_slug`, and the
  frontend's platform-admin API client never sends `X-Tenant-Slug` or hits a tenant subdomain,
  `_resolve_slug` naturally returns `None` for these requests and no tenant DB context is set —
  which is exactly what `/platform/*` views already expect (per their own docstring: "No tenant DB
  access — all queries run against the master DB").

---

## 3. Frontend

- New route `frontend/src/app/(platform)/admin/login/page.tsx` — email + password only, no
  workspace field. Separate from the tenant-scoped `(auth)/login` page.
- New `platformAuthApi` client (`frontend/src/lib/api/platformAuth.ts`, mirrors `authApi`) — calls
  `/platform/auth/*` and never sends `X-Tenant-Slug`.
- New `usePlatformAuthStore` (separate from `useAuthStore`) with its own minimal user shape
  (`{id, email, full_name}`) — deliberately not reusing `AuthUser`, whose `permissions`/
  `shop_ids`/`role_ids`/`hasPermission`/`hasShopAccess` fields and helpers mean nothing for a
  platform admin.
- `PlatformLayout` (`frontend/src/app/(platform)/platform/layout.tsx`) currently bootstraps via
  `authApi.refresh()`/`authApi.me()` and redirects to `/login` on failure. This changes to use
  `platformAuthApi`/`usePlatformAuthStore` and redirect to `/admin/login` instead.

---

## 4. Provisioning & cutover

- `python manage.py create_platform_admin --email ... --password ...` — master-DB-only management
  command, no public signup. Matches the existing `create_tenant` command's pattern.
- `backend/entrypoint.sh` and `infra/docker/seed.sh` are updated to call this command for local dev
  bootstrapping (replacing the current reliance on `seed_demo` normalising a tenant-DB user into a
  platform admin).
- The existing `platform@repaiross.app` row in the `demo` tenant DB is retired: its
  `is_platform_admin` flag handling is removed from `authentication/seeds.py`, and the row is no
  longer specially maintained by `seed_demo`. A fresh platform admin is created via the new command
  instead, using the same `platform@repaiross.app` / `Demo@1234!` credentials as today (same
  `core.seeds.DEMO_PASSWORD` constant) so nothing else about local dev bootstrapping changes —
  only where the account lives and how it logs in.

## 5. Out of scope / explicitly not touched

- The ~20 `token.get("is_tenant_wide") or token.get("is_platform_admin")` bypass checks in
  CRM/HR/billing/inventory/pos/repair views are **left in place**. They become unreachable for
  genuine platform-admin tokens (which never carry `tenant_slug` and are never presented to those
  endpoints by the frontend), but ripping out ~20 call sites across unrelated apps is outside this
  change's blast radius. Flagged as a possible future cleanup, not done here.
- No "impersonate tenant" / support-login feature. If platform staff need to view/act inside a
  specific tenant's data later, that's a separate, explicitly-designed feature.
- No self-service platform-admin signup or admin-manages-admins UI.
- No per-admin roles/permission levels — one flat platform-admin capability level.

## 6. Testing

- Backend: pytest coverage for `create_platform_admin` command, login (success/failure/lockout),
  refresh (rotation + replay detection), logout, `/platform/*` access with and without a valid
  platform-admin token, and confirmation that a tenant-issued JWT (with `tenant_slug`) is rejected
  by `PlatformAdminJWTAuthentication`.
- Frontend: Vitest coverage for `usePlatformAuthStore` and the `/admin/login` page; existing
  `PlatformLayout` tests updated for the new bootstrap/redirect target.
- E2E: log in at `/admin/login` with no workspace field, land on `/platform/tenants`, confirm a
  tenant user's credentials are rejected there and a platform admin's credentials are rejected on
  the normal `/login` page.
