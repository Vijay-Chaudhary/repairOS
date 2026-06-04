# Frontend Foundation 03 — Data Layer

> How the frontend talks to the backend: the typed API client, TanStack Query patterns, auth-token handling, Zustand stores, the WebSocket client, error-envelope handling, idempotency, and offline.

---

## 1. API client (`lib/api/`)
A single typed `fetch` wrapper, one endpoint module per backend module (`lib/api/repair.ts`, `crm.ts`, …), each function typed to the backend's request/response shapes.

Responsibilities of the wrapper:
- Base URL + JSON headers.
- Attach `Authorization: Bearer {accessToken}` from the auth store (in-memory).
- On `401 NOT_AUTHENTICATED` → attempt one silent refresh (§3), retry once, else hard logout.
- Parse the **standard envelope** (foundation/03 backend §2): on `success:false` throw a typed `ApiError { code, message, fields }`.
- Attach `Idempotency-Key` (UUID) automatically on payment/notification POSTs.
- Never log tokens.

```ts
// shape
type Ok<T>  = { success: true;  data: T; meta?: PageMeta };
type Err    = { success: false; error: { code: string; message: string; fields?: Record<string,string[]> } };
class ApiError extends Error { code: string; fields?: Record<string,string[]>; }
```

## 2. TanStack Query (`lib/query/`)
- One `QueryClient`; `staleTime` 30s default, 0 for money/stock, 5min for catalogue.
- **Query-key factory** keyed by module + filters + active shop, e.g. `['jobs', { shopId, status, cursor }]`. Active shop is part of the key so switching shops refetches cleanly.
- Lists use `useInfiniteQuery` with the backend `next_cursor`.
- Mutations invalidate the minimal key set; optimistic updates only where §safe.
- `ApiError` surfaced to a global toast for unexpected codes; field errors (`VALIDATION_ERROR.fields`) are routed back into the form (§5).

| Query key | Source |
|---|---|
| `['jobs', filters]` / `['job', id]` | repair |
| `['customers', filters]` / `['customer', id]` | crm |
| `['products', filters]` / `['stock', shopId]` | inventory |
| `['invoices', filters]` / `['invoice', id]` | billing |
| `['dashboard', shopId]` | reports |
| …one per module resource | |

## 3. Auth tokens (mirrors backend auth §1)
- **Access token**: held in a Zustand store **in memory only** (never localStorage/cookie — XSS). Lost on full reload → silent refresh rehydrates it.
- **Refresh token**: backend sets an **HttpOnly Secure SameSite=Strict cookie**; the client never reads it. `POST /auth/token/refresh/` is called with credentials to get a new access token.
- **Bootstrap on load**: app mounts → call refresh → if success, populate store + fetch `me`; if `401 REFRESH_TOKEN_INVALID/REUSE` → go to login.
- **Refresh rotation / replay**: a `REFRESH_TOKEN_REUSE` response means the family was revoked → force re-login everywhere; show "your session ended for security".
- **Access token expiry (15min)**: handled lazily on next 401, plus a proactive refresh timer at ~13min.

## 4. Zustand stores (`lib/stores/`)
| Store | Holds |
|---|---|
| `authStore` | accessToken (memory), user { id, name, permissions[], shop_ids[], is_platform_admin } |
| `activeShopStore` | activeShopId (persisted to localStorage), helper `isAllShops` |
| `uiStore` | sidebar collapsed, theme, command-palette open, pending-toast |
| `offlineQueueStore` | queued mutations (mirrors IndexedDB, §8) |

`hasPermission(code)` and `hasAnyShop()` selectors live on `authStore` and back the `<Can>` component and route guards.

## 5. Forms (React Hook Form + Zod)
- Zod schema per form **mirrors backend validation** (e.g. `problem_description` min 10; phone E.164; field-job requires location). Client validation is UX only — backend re-validates.
- On submit → mutation. On `ApiError.code === 'VALIDATION_ERROR'` map `error.fields` onto RHF `setError` so messages land on the right inputs.
- Money inputs use the `MoneyInput` (decimal, 2dp); never use native number type for currency.
- Disable submit while pending; show inline spinner; success → toast + navigate/close.

## 6. WebSocket client (`lib/ws/`)
- Connect on login to `wss://…/ws/` and subscribe to `shop.{activeShopId}` (re-subscribe on shop switch).
- Platform-admin app subscribes to the master channel (`tenant.db_provisioned`) instead.
- Reconnect with backoff; on reconnect, **invalidate live queries** (jobs, payments, stock, tasks) so cache catches up on anything missed offline.
- Event → action map (per-module detail in each UI doc):
  - `job.status_changed` → invalidate `['jobs']` + `['job', id]`, toast if relevant to me.
  - `payment.received` → invalidate dashboard revenue + invoice.
  - `stock.low_alert` → toast to manager + badge on Inventory nav.
  - `task.due_soon` → toast + badge.
  - `stage.handoff` → if assigned to me, toast + invalidate my jobs.

## 7. Formatting (`lib/format/`)
- `money(n)` → `₹1,23,456.00` (Indian grouping, 2dp, tabular).
- `gst(state, counterpartyState, rate, base)` helper to display split (intra → CGST+SGST, inter → IGST) — display only; backend computes authoritative values.
- `date`/`datetime` in IST; relative ("2h ago") on timelines.
- `phone` display `+91 98123 45678`.

## 8. Offline (PWA)
- **Reads**: served from Query cache + SW (stale-while-revalidate). Show a subtle "offline — showing saved data" banner.
- **Queueable writes** (idempotent, non-financial): log communication, mark attendance, add job note/photo, complete task → write to IndexedDB `offlineQueue` with a generated `Idempotency-Key`; optimistic UI; flush on reconnect; on conflict show a resolve toast.
- **Blocked offline**: payments, invoice generation, sales, stock adjustments, salary generation → disabled with "needs connection".
- Queue visible in a small "pending sync" indicator; user can see/retry.

## 9. Error → UX mapping (from backend error registry)
| Code | UX |
|---|---|
| VALIDATION_ERROR | field errors inline |
| PERMISSION_DENIED | 403 screen / hidden control (shouldn't normally hit) |
| NOT_FOUND | "not found" empty state |
| INSUFFICIENT_STOCK | inline on quantity, block submit |
| CREDIT_LIMIT_EXCEEDED | block + show outstanding vs limit |
| INVALID_STATUS_TRANSITION | toast + refresh status (someone else changed it) |
| ACCOUNT_LOCKED / OTP_* | auth screen messaging + countdown |
| RATE_LIMIT_EXCEEDED | toast with Retry-After countdown |
| TENANT_DB_UNAVAILABLE / PROVISIONING_IN_PROGRESS | full-screen "setting things up / temporarily unavailable", auto-retry |
| INTERNAL_ERROR | generic toast + Sentry breadcrumb |
