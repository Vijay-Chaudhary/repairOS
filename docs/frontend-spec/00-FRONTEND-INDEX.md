# RepairOS — Frontend Specification (v1, pairs with backend v3.1-dev)

> The frontend counterpart to the backend spec. Same philosophy: foundation docs that everything shares, then one UI spec per module that **pairs 1:1 with its backend module** (`frontend/modules/02-repair-ui.md` ↔ `backend modules/02-repair.md`). Hand Claude Code both files for a module and it has the full vertical slice — data contract + screens.

---

## 1. What the frontend is

A single **Next.js 14 (App Router) Progressive Web App** — no native app (AD-11). It must feel instant on a mid-range Android phone over patchy 4G, be usable one-handed at a service counter, and stay legible in bright sunlight. Every screen is multi-tenant- and multi-shop-aware: the logged-in user sees only their tenant's data (enforced by the backend connection) and only the shops they have access to (enforced by `shop_id` + UI shop switcher).

The product is **data-dense and money-heavy** (jobs, invoices, GST, stock, payroll). The UI prioritises legibility, fast data entry, and trustworthy numbers over decoration.

---

## 2. File structure

```
RepairOS-frontend-spec/
├── 00-FRONTEND-INDEX.md           ← you are here
│
├── foundation/
│   ├── 01-app-architecture.md     ← Next.js App Router layout, routing map, RSC vs client,
│   │                                 PWA / service worker / offline, performance budgets
│   ├── 02-design-system.md        ← brand direction, tokens, typography, color, spacing,
│   │                                 shadcn/ui setup, core component patterns, a11y, mobile
│   ├── 03-data-layer.md           ← API client, TanStack Query, auth tokens, Zustand,
│   │                                 WebSocket client, error-envelope handling, idempotency
│   └── 04-auth-rbac-ui.md         ← login / OTP screens, route guards, permission gating,
│                                     shop switcher, session lifecycle
│
└── modules/                        ← one UI spec per backend module
    ├── 01-crm-ui.md
    ├── 02-repair-ui.md
    ├── 03-pos-ui.md
    ├── 04-amc-ui.md
    ├── 05-inventory-ui.md
    ├── 06-procurement-ui.md
    ├── 07-billing-ui.md
    ├── 08-commissions-ui.md
    ├── 09-hr-payroll-ui.md
    ├── 10-finance-ui.md
    ├── 11-reports-ui.md
    └── 12-platform-admin-ui.md
```

---

## 3. The module-UI template

Every `modules/NN-*-ui.md` follows this shape:

| # | Section | Purpose |
|---|---------|---------|
| 1 | **Screens & routes** | Every screen, its App Router path, and who can reach it. |
| 2 | **Navigation & layout** | Where it sits in nav; page layout (list/detail/wizard/board). |
| 3 | **Components** | Reusable components the module needs (and which are shared). |
| 4 | **Forms & validation** | Each form: fields, client validation (mirrors backend rules), submit behaviour. |
| 5 | **States** | Loading / empty / error / success / permission-denied states per screen. |
| 6 | **API wiring** | Which backend endpoints each screen calls; query keys; mutations. |
| 7 | **Real-time** | WebSocket events the module subscribes to and what they update. |
| 8 | **Permissions in UI** | Which controls are gated by which permission codename. |
| 9 | **Mobile notes** | One-handed / counter / field-technician considerations. |
| 10 | **Acceptance criteria** | Definition of done for the module's UI. |

---

## 4. Cross-cutting rules (every screen obeys)

1. **Permission-gated rendering.** Never render a control the user can't use. Gate with the `<Can permission="...">` component (foundation/04). The backend is still the source of truth (403), but the UI must not show dead buttons.
2. **Shop scoping.** Every list/detail respects the active shop from the shop switcher; tenant-wide roles can switch or view "All shops".
3. **Optimistic where safe, confirmed where money moves.** Status toggles and task completes can be optimistic; payments, stock changes, and invoice generation wait for server confirmation.
4. **Money & numbers** use tabular figures and a single currency formatter (₹, Indian grouping: ₹1,23,456.00). GST always shows the CGST/SGST/IGST split.
5. **Every destructive action** confirms; every soft-delete is reversible-in-copy ("Deactivate", not "Delete").
6. **Offline-tolerant reads.** Core read screens render from TanStack Query cache when offline; writes queue or fail clearly (foundation/03 §offline).

---

## 5. Build order (recommended)

1. `foundation/01–04` — nothing renders correctly without the shell, tokens, data layer, and auth.
2. `02-repair-ui` + `01-crm-ui` — the daily-driver core; proves the patterns.
3. `07-billing-ui` + `03-pos-ui` — money in.
4. `05-inventory-ui` + `06-procurement-ui` — stock.
5. `04-amc-ui`, `08-commissions-ui`, `09-hr-payroll-ui`, `10-finance-ui`.
6. `11-reports-ui` (dashboard early as a stub, full late), `12-platform-admin-ui` (separate app surface).

---

## 6. Status

All foundation docs and 12 module UI specs are built. Foundation is deep; module specs are focused on screens, forms, states, and API wiring (not pixel-level layout — that's the design system + your judgement). Anything marked `🔧 PROPOSED` is a product/UX decision I made where the backend was silent — flag any to change.
