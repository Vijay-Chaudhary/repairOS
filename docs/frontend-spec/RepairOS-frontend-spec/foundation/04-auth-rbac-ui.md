# Frontend Foundation 04 — Auth & RBAC UI

> Login / OTP screens, the registration→provisioning flow, route guards, permission-gated rendering, the shop switcher, and session lifecycle.

---

## 1. Public auth screens

### `/login`
Email + password. On submit → `POST /auth/login/`. Success → store access token, fetch `me`, redirect to `/dashboard`. Errors:
- `INVALID_CREDENTIALS` → inline "email or password is incorrect".
- `ACCOUNT_LOCKED` → show `locked_until` countdown, suggest reset.
Link: "Sign in with OTP" → `/otp`.

### `/otp`
Step 1: phone → `POST /auth/otp/request/` → show 10-min countdown, `OTP_RATE_LIMIT` handled with Retry-After. Step 2: 6-digit code → `POST /auth/otp/verify/`. `INVALID_OTP` inline; `OTP_EXPIRED` → re-request.

### `/register` (→ Platform Admin module)
Business name, slug (auto-suggested, live uniqueness check), owner name, phone, email, password (strength meter: 8+, upper, number, special). Submit → `POST /register/` → **provisioning poll screen** ("Setting up your workspace…", animated, polls tenant status) → on `active` redirect to onboarding wizard (`12-platform-admin-ui`). On `provisioning_failed` → friendly retry screen.

## 2. Session lifecycle (client)
On app mount inside `(app)`: try silent refresh → populate `authStore` + fetch `me` → connect WebSocket → render shell. If refresh fails → `/login`. Proactive refresh timer ~13 min. `REFRESH_TOKEN_REUSE` anywhere → wipe store, full logout, "session ended for security". Logout button → `POST /auth/logout/` → wipe store + disconnect WS → `/login`.

## 3. Route guards
A client guard in `(app)/layout.tsx`:
1. Not authenticated → redirect `/login`.
2. Authenticated but route needs a permission the user lacks → render the **403 screen** (not a redirect — avoids loops, and the nav already hid the link).
3. `is_platform_admin` users are scoped to `(platform)`; tenant users cannot reach `(platform)` and vice-versa.

Each route group declares its required permission (map in `01-app-architecture` §4); the guard reads `authStore.hasPermission`.

## 4. Permission-gated rendering — `<Can>`
```tsx
<Can permission="repair.jobs.create">
  <Button onClick={…}>New job</Button>
</Can>
// also: <Can anyOf={['pos.returns.approve','...']}> , <Can fallback={<Locked/>}>
```
Rules:
- Never render an actionable control the user can't use. Hide it (or show a disabled "locked" variant where its absence would confuse).
- "own"-scoped permissions (technician sees only own jobs): the UI additionally filters lists by `assigned_technician_id === me` and hides cross-tech actions. Backend still enforces.
- Nav items themselves are gated — a Technician's sidebar shows Jobs + Commissions (own) + profile, not HR/Settings.

## 5. Shop switcher (topbar)
- Lists the user's `shop_ids[]` (names from `me`). Tenant-wide roles also get **"All shops"**.
- Selection updates `activeShopStore` → persisted → re-keys shop-scoped queries (foundation/03 §2) and re-subscribes WebSocket to `shop.{id}`.
- "All shops" disables shop-create actions that require a single target shop; report screens accept it.

## 6. Role → default landing & nav (from backend auth §4)
| Role | Lands on | Primary nav |
|---|---|---|
| Tenant Admin | dashboard | everything |
| Shop Manager | dashboard | jobs, crm, pos, inventory, purchases, amc, hr, finance, reports (their shops) |
| Receptionist | jobs | jobs, customers/leads, counter sale, tasks |
| Technician | my jobs | my jobs, my commission, profile |
| Billing Staff | invoices | invoices, payments, pos, financial reports |
| HR Manager | hr | employees, attendance, leave, salary, petty cash |
| Viewer | dashboard | read-only across permitted screens |
| Platform Admin | `/platform` | tenants, plans, provisioning monitor |

## 7. Acceptance criteria
- [ ] Access token never persisted to storage; survives reload via refresh cookie.
- [ ] `REFRESH_TOKEN_REUSE` forces global logout with clear messaging.
- [ ] Lacking-permission route renders 403, never loops.
- [ ] No actionable control rendered without its permission; nav reflects role.
- [ ] Shop switch re-scopes queries + WS without full reload.
- [ ] Registration shows live provisioning status and lands in the onboarding wizard.
