# Frontend Foundation 01 — App Architecture

> Next.js 14 App Router structure, rendering strategy, the full route map, PWA/offline, and performance budgets. Read before any module.

---

## 1. Stack (from backend architecture §7)
Next.js 14 (App Router) · React 18 · TypeScript (strict) · Zustand (client state) · TanStack Query v5 (server state) · shadcn/ui + Tailwind · `next-pwa` (Workbox service worker) · ZXing-js (barcode) · Recharts (reports) · React Hook Form + Zod (forms). API base `https://api.repaiross.app/api/v1/`.

## 2. Rendering strategy
This is an **authenticated, data-heavy SPA-style app**, so it is predominantly **client-rendered behind auth**, not SSR-per-request.

- **Server Components** for static shell, layouts, and the marketing/auth pages (`/`, `/register`, `/login`).
- **Client Components** for everything behind login (dashboards, forms, real-time). Reason: data is per-user, per-shop, live, and offline-cached — SSR adds latency and complicates the in-memory-token auth model (tokens live in JS memory, not cookies readable by the server, except the HttpOnly refresh cookie).
- No use of Next.js server actions for tenant data mutations — all writes go through the typed API client (foundation/03) so the same client works offline and in the PWA.

## 3. Folder layout
```
app/
├── (marketing)/            # public, server-rendered
│   ├── page.tsx            # landing
│   └── register/page.tsx   # signup → provisioning poll
├── (auth)/
│   ├── login/page.tsx
│   └── otp/page.tsx
├── (app)/                  # authenticated shell (client)
│   ├── layout.tsx          # AppShell: sidebar + topbar + shop switcher + providers
│   ├── dashboard/page.tsx
│   ├── jobs/               # repair module
│   ├── customers/ leads/   # crm
│   ├── pos/ sales/         # pos
│   ├── amc/                # amc
│   ├── inventory/ products/
│   ├── purchases/ suppliers/
│   ├── invoices/ payments/ # billing
│   ├── commissions/
│   ├── hr/                 # employees, attendance, leave, salary
│   ├── finance/            # petty cash, expenses, budget, assets
│   ├── reports/
│   └── settings/           # shop, roles, users, commission rules, notifications, whatsapp
├── (platform)/             # platform-admin surface (separate auth)
│   └── platform/...
components/
├── ui/                     # shadcn primitives (button, input, dialog, table…)
├── shared/                 # AppShell, DataTable, MoneyInput, StatusBadge, Can, EmptyState…
└── charts/
lib/
├── api/                    # typed API client + endpoint modules (per backend module)
├── query/                  # TanStack Query client, query-key factory
├── stores/                 # Zustand stores (auth, activeShop, ui)
├── ws/                     # WebSocket client
├── format/                 # currency, date, gst formatters
└── pwa/                    # offline queue, sync
```

## 4. Route map (App Router → permission)
| Path | Module | Min permission |
|---|---|---|
| `/dashboard` | Reports | any authenticated |
| `/jobs`, `/jobs/[id]`, `/jobs/new` | Repair | repair.jobs.view / .create |
| `/leads`, `/customers`, `/customers/[id]` | CRM | crm.* |
| `/pos`, `/sales/[id]` | POS | pos.* |
| `/amc`, `/amc/[id]` | AMC | amc.contracts.view |
| `/inventory`, `/products` | Inventory | erp.inventory.view |
| `/purchases`, `/suppliers` | Procurement | erp.* |
| `/invoices`, `/invoices/[id]`, `/payments` | Billing | billing.* |
| `/commissions` | Commissions | hr.salary.view (own for tech) |
| `/hr/*` | HR | hr.* |
| `/finance/*` | Finance | erp.* / hr.petty_cash.manage |
| `/reports`, `/reports/[type]` | Reports | reports.{module}.view |
| `/settings/*` | Settings | settings.* |
| `/platform/*` | Platform Admin | is_platform_admin |

Route guards in foundation/04. A user hitting a route they lack permission for sees a 403 screen, not a redirect loop.

## 5. PWA & offline
- **Manifest**: installable, standalone display, themed (design tokens), shop logo as icon where branded.
- **Service worker (Workbox via next-pwa)**:
  - App shell + static assets: cache-first.
  - GET API reads (jobs list, customer, products): stale-while-revalidate, also held in TanStack Query cache.
  - Writes: network-only; if offline, enqueue (see below).
- **Offline write queue** (foundation/03 §offline): safe-to-queue mutations (log communication, mark attendance, add job note) go to an IndexedDB queue and flush on reconnect with their `Idempotency-Key`. **Money mutations (payments, invoices, sales) are NOT queued** — they require connectivity and show a clear "you're offline" block.
- **Install prompt**: offered after first successful job/sale, not on first load.

## 6. Performance budgets (mirror backend NFR §8.1)
| Metric | Target |
|---|---|
| Dashboard LCP | < 2.5 s on mid Android / 4G |
| Route transition | < 200 ms (cached) |
| POS add-to-cart → total | < 100 ms (local calc) |
| JS bundle (initial, gzipped) | < 200 KB; route-split the rest |
| Largest list render | virtualised beyond 50 rows |

Code-split per route group; lazy-load Recharts, ZXing, PDF preview. Prefetch likely next routes (job list → job detail).

## 7. Tenant/shop context in the client
- On login the access token carries `tenant_slug`, `shop_ids[]`, `permissions[]`. The client never builds tenant into URLs (backend resolves from JWT).
- **Active shop** is a Zustand store value, defaulting to the user's first shop, persisted to `localStorage` (non-sensitive). It's attached as a filter param on shop-scoped queries and as `shop_id` in create payloads.
- Tenant-wide roles (Tenant Admin, HR Manager) get an "All shops" option where it makes sense (reports, dashboards).
