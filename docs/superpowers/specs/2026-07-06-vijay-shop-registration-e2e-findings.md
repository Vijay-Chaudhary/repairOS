# Vijay Shop registration — E2E UI test findings (2026-07-06)

**Goal:** Register a brand-new tenant ("Vijay Shop") entirely through the real `/register` frontend UI (form fill → submit → phone/email OTP verify → provisioning → dashboard), driven by a Playwright script, immediately after wiping all 17 pre-existing tenants.

**Result:** ✅ Succeeded on the 4th attempt. Tenant `vijay_shop` is active, provisioned, and the login lands on `/dashboard` as `Vijay Kumar <vijay@vijayshop.com>`. Three real issues surfaced along the way — one in the test script, two in the app itself (one of which is a genuine, reproducible frontend bug worth fixing).

---

## Attempt 1 — script selector bug (test-only, not an app bug)

`page.get_by_label("Business name")` (and other fields) timed out — the shadcn `FormLabel` on this page doesn't resolve via Playwright's accessible-label lookup the way a plain `<label for>`/`aria-label` does. Switched to placeholder/type-based selectors (`input[placeholder="Sunrise Repairs"]`, `input[type="password"]`, etc.), which worked immediately. No app change needed.

## Attempt 2 — stale `X-Tenant-Slug: demo` header breaks registration after a tenant wipe (real bug)

**Symptom:** Every submit of the registration form failed at the `Continue` button; network tab showed `POST /api/v1/register/ → 404` with no visible error text on the form (the frontend's error banner never rendered anything, `inline_error` was empty).

**Root cause:**
- `frontend/src/lib/api/client.ts:83` — `apiFetch()` unconditionally attaches `X-Tenant-Slug: <NEXT_PUBLIC_TENANT_SLUG>` to **every** request, including calls made with `skipAuth: true` such as `/register/`, `/register/verify/`, `/register/status/`, and `/login/`. There is no tenant yet at registration time — this header should never be sent for these endpoints.
- `.env` had `NEXT_PUBLIC_TENANT_SLUG=demo` as a local-dev convenience default (assumes a `demo` tenant always exists).
- We had just deleted the `demo` tenant (along with all other tenants) as part of an earlier cleanup task in this session.
- Backend's tenant-resolution middleware saw the (unwanted, stale) `X-Tenant-Slug: demo` header, tried to resolve tenant `demo`, found nothing, and returned `404 {"error": {"code": "NOT_FOUND", "message": "Tenant 'demo' not found or is not active."}}` — before the request ever reached `RegisterView`.
- This is **not** register-specific: it silently breaks every frontend request whenever the configured default tenant slug doesn't exist. It happened to surface here because we'd just wiped all tenants, but the underlying bug (public/tenant-less endpoints sending a tenant header at all) is real and independent of that.

**Confirmed via:**
- `curl` directly to `/api/v1/register/` with no `X-Tenant-Slug` header → `202`, dev codes returned correctly. Proved the backend endpoint itself was fine.
- Captured the actual browser request/response with a raw Playwright request/response listener → showed the `X-Tenant-Slug: demo` header on the outgoing POST and the middleware's 404 body, pinpointing the exact cause.

**Fix applied (session-scoped, not a code change — by explicit user choice):** Cleared `NEXT_PUBLIC_TENANT_SLUG=` in `.env` and force-recreated the `frontend` container so the empty value takes effect (this is a `NEXT_PUBLIC_*` var, inlined into the JS bundle per-build, so a plain restart without an env change would not have been enough).

**Recommended follow-up (not done — needs a decision, offered as an option and declined for now):** Fix `client.ts`'s `apiFetch()` so it never attaches `X-Tenant-Slug` when `skipAuth: true` (or more precisely, only ever for endpoints that are actually tenant-scoped). That would make this entire class of failure impossible regardless of what `NEXT_PUBLIC_TENANT_SLUG` is set to.

**Side effect of the fix:** Restarting `frontend` cascaded into Docker Compose restarting `backend` too (both consume the same `.env` via `env_file:`), which re-ran `backend/entrypoint.sh` and therefore recreated the `demo` and `testshop` tenants via `create_tenant`/`seed_demo --if-empty` — exactly the documented, intended behavior of that entrypoint. This is expected, not a bug, and doesn't affect the `vijay_shop` tenant or this test.

## Attempt 3 — test script bug reading the wrong response shape (test-only, not an app bug)

After the header fix, the actual `/register/` call succeeded (`202`, dev codes present), but the script's own check (`body.get("dev_phone_otp")`) looked at the wrong nesting level. The real API response envelope is `{"success": true, "data": {...actual fields...}}` (matches the frontend's own `Ok<T>` type in `client.ts`) — fixed the script to read `body["data"]["dev_phone_otp"]` instead of `body["dev_phone_otp"]`.

## Attempt 4 — success

Full flow completed end-to-end through the real UI:
1. Filled and submitted the registration form (business name "Vijay Shop", slug auto-generated to `vijay_shop`, owner "Vijay Kumar", phone `+919999911111`, email `vijay@vijayshop.com`).
2. Read `dev_phone_otp` / `dev_email_code` from the register API's own response (the intended local-dev path — there is no real SMS/email gateway configured; `master/services.py`'s `_send_registration_otp`/`_send_registration_email_code` just log the codes and return them in the response body when `DEBUG=True`).
3. Filled both 6-digit OTP box groups and clicked "Verify & create workspace".
4. Polled through the provisioning screen ("Setting up your workspace…" → "Workspace ready!").
5. Landed on `http://localhost:3000/dashboard`, logged in as `Vijay Kumar <vijay@vijayshop.com>`, tenant `vijay_shop` fully provisioned (empty dashboard: 0 jobs, ₹0 revenue — expected for a brand-new shop).

Verified independently via `manage.py shell`: `Tenant.objects.get(slug='vijay_shop')` — `status=active`, `name=Vijay Shop`, `owner_email=vijay@vijayshop.com`, `db_name=repaiross_tenant_vijay_shop`.

---

## Summary of what's worth acting on

| Finding | Severity | Status |
|---|---|---|
| `apiFetch()` sends `X-Tenant-Slug` on tenant-less/public endpoints (`skipAuth` calls) | Real bug — breaks registration/login whenever the default tenant slug is stale or unset | Not fixed in code; worked around via `.env`. Recommend fixing `client.ts` if this default-slug pattern stays in use. |
| Playwright `get_by_label` doesn't resolve this page's shadcn `FormLabel`-wrapped inputs | Test tooling only | Resolved — use placeholder/type selectors for this form. |
| Register success response nests fields under `data` | Not a bug — just my script's initial misread of a normal envelope | Resolved. |
