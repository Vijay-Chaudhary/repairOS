# Frontend Foundation 02 — Design System

> Brand direction, design tokens, typography, color, spacing, shadcn/ui setup, the core shared components, accessibility, and mobile-first rules. This is the visual contract every screen inherits.

---

## 1. Design direction 🔧 PROPOSED

RepairOS is a **utilitarian workshop tool**, not a consumer lifestyle app. The aesthetic is **"calm instrument panel"**: high-contrast, dense-but-legible, confident single accent, zero decorative noise. It must read at arm's length on a counter and in sunlight. Think field-tool, not dribbble.

Principles: legibility over flair · numbers are first-class (tabular, aligned) · one strong accent for primary actions and live state · generous tap targets · status communicated by color *and* label (never color alone). If you want a different direction (e.g. warmer/friendlier), this is the file to change — everything downstream reads from the tokens.

## 2. Typography 🔧 PROPOSED
**IBM Plex Sans** (UI/body) + **IBM Plex Mono** (codes, invoice/job numbers, barcodes). Rationale: excellent small-size legibility on cheap Android, true **tabular figures** for money columns, an open-source Devanagari sibling if you ever localise, and it avoids the generic Inter/Roboto look. Self-host via `next/font` (no layout shift, works offline).

| Token | Size / line | Use |
|---|---|---|
| display | 28/34 600 | page titles |
| h1 | 22/28 600 | section headers |
| h2 | 18/24 600 | card headers |
| body | 15/22 400 | default |
| body-sm | 13/18 400 | secondary/meta |
| mono-num | 15/22 500 tnum | money, counts |
| code | 13/18 500 mono | invoice/job/PO numbers |

## 3. Color tokens (CSS variables; light default, dark supported)
```css
:root {
  --bg:        #f7f8fa;   --surface:   #ffffff;   --surface-2: #f1f3f6;
  --border:    #e2e6ec;   --text:      #11161d;   --text-muted:#5b6573;
  --accent:    #1f6feb;   /* primary actions, links, active nav */
  --accent-fg: #ffffff;
  --success:   #1a7f48;   --warning:   #b25e00;   --danger:    #c1392b;
  --info:      #2a6f97;
  /* status hues (job/invoice/etc) paired with labels, never color-only */
  --status-open:#2a6f97; --status-progress:#b25e00; --status-ready:#1a7f48;
  --status-hold:#8a6d3b; --status-closed:#5b6573; --status-cancelled:#c1392b;
}
.dark { --bg:#0d1117; --surface:#161b22; --surface-2:#1c232c; --border:#2a313c;
        --text:#e6edf3; --text-muted:#9aa4b2; --accent:#4d8bf0; }
```
Accent (`--accent`) is the single brand color; resume-blue-adjacent but product-tuned for sunlight contrast. Swap one variable to rebrand. All component colors reference variables — no hard-coded hex in components.

## 4. Spacing, radius, shadow
4px base scale (4/8/12/16/24/32/48). Radius: `sm 6 / md 10 / lg 14 / full`. Shadows: subtle only (`sm` for cards, `md` for popovers/dialogs) — no heavy drop shadows. Tap target **min 44×44px** everywhere (counter use, possibly gloved).

## 5. shadcn/ui setup
Use shadcn/ui primitives, themed to the tokens above (not the default zinc palette). Components in `components/ui/`. Configure `tailwind.config` to map Tailwind colors to the CSS variables so utilities like `bg-accent` resolve to the token. Install as needed: button, input, select, dialog, sheet, dropdown-menu, table, tabs, badge, toast (sonner), command, calendar, popover, skeleton, alert-dialog, form (RHF wrapper).

## 6. Core shared components (`components/shared/`)
| Component | Purpose |
|---|---|
| `AppShell` | sidebar (collapsible to icons on mobile → bottom tab bar), topbar (shop switcher, search, notifications, profile) |
| `DataTable` | sortable, filterable, cursor-paginated, virtualised >50 rows, row-action menu, empty/loading/error slots, CSV export hook |
| `StatusBadge` | maps a status enum → color token + label (job, invoice, PO, contract…) |
| `MoneyInput` / `Money` | input + display; Indian grouping, ₹, tabular figures, 2 dp |
| `GstBreakdown` | shows subtotal, CGST/SGST or IGST, total |
| `Can` | permission gate: `<Can permission="repair.jobs.create">…</Can>` |
| `ShopScope` | renders active-shop filter; "All shops" for tenant-wide roles |
| `EmptyState` | icon + message + primary CTA (every list has one) |
| `ConfirmDialog` | destructive-action confirmation |
| `EntityTimeline` | chronological event feed (used by CRM, job, contract) |
| `PhotoUploader` | multi-photo capture → S3 presigned upload (check-in, AMC visit, receipts) |
| `SignaturePad` | canvas signature → S3 (check-in, AMC visit) |
| `BarcodeScanner` | ZXing camera scan → callback (POS, inventory) |
| `Stepper` | multi-step wizard (onboarding, multi-stage job setup) |
| `KpiCard` | dashboard metric tile |

## 7. Status color map (color + label, accessible)
| Domain | Statuses → token |
|---|---|
| Job | open→info, in_progress→warning, on_hold→`#8a6d3b`, ready_for_pickup/qc→success, delivered→accent, closed→muted, cancelled→danger |
| Invoice/Sale | draft→muted, issued→info, partially_paid→warning, paid→success, cancelled/returned→danger |
| PO | draft→muted, sent→info, partially_received→warning, received→success |
| Contract | active→success, pending_renewal→warning, expired/cancelled→danger |
| Task/Lead | pending/new→info, overdue/lost→danger, completed/converted→success |

## 8. Accessibility
WCAG AA contrast on all text (tokens chosen to pass). Full keyboard nav; focus-visible rings (accent). Status never communicated by color alone — always paired label/icon. Forms: label + error text + `aria-invalid`. Respect `prefers-reduced-motion` and `prefers-color-scheme`.

## 9. Mobile-first rules
Design at 360px first. Sidebar → bottom tab bar (Dashboard, Jobs, POS, More) on phones. Tables → stacked cards below `md`. Sticky primary action (e.g. "Add payment", "Complete stage") as a bottom bar on detail screens. Number pad `inputmode="decimal"` on money fields; `inputmode="tel"` on phone fields. Pull-to-refresh on key lists.

## 10. Motion
Restrained. 150–200ms ease for enter/exit, dialog/sheet slide, toast. One staggered reveal on dashboard load. No gratuitous animation on data tables. Use Motion (framer) only where it earns its weight.
