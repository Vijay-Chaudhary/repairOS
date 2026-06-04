Build the RepairOS frontend from scratch. The previous frontend has already been
removed — do not restore it.

SPECS (read before writing any code):
- docs/frontend-spec/RepairOS-frontend-spec/ — read 00-FRONTEND-INDEX.md, then ALL of
  foundation/ (01-app-architecture, 02-design-system, 03-data-layer, 04-auth-rbac-ui).
- docs/backend-spec/RepairOS-dev-spec/ — the API contracts. NEVER invent an endpoint or
  payload; use the exact ones in the matching backend module file.
- For each feature, read the module pair together, e.g. frontend modules/02-repair-ui.md
  + backend modules/02-repair.md.

STACK: Next.js 14 App Router, TypeScript strict, Tailwind + shadcn/ui (themed to the
design tokens, NOT default zinc), TanStack Query v5, Zustand, React Hook Form + Zod,
next-pwa. IBM Plex Sans/Mono via next/font.

NON-NEGOTIABLE RULES (from the foundation docs):
- Access token in memory only (Zustand) — never localStorage/cookie. Refresh via the
  HttpOnly cookie + /auth/token/refresh/ on 401 and a ~13min timer.
- Permission-gate every action with the <Can> component; nav reflects role. Never render
  a control the user lacks permission for.
- All colors via the CSS variables in 02-design-system; no hard-coded hex in components.
- Money via the single ₹ Indian-grouping tabular formatter; GST always shows the
  CGST/SGST/IGST split.
- Mobile-first at 360px; 44px min tap targets; offline rules from 03-data-layer §8
  (queue safe non-financial writes; BLOCK payments/invoices/sales/stock when offline).
- Match query-key factory + error-code→UX table in 03-data-layer exactly.

BUILD ORDER (follow the index §5):
1. Scaffold the app + folder layout from 01-app-architecture §3, wire providers.
2. Foundation: design tokens + Tailwind config, shadcn setup, AppShell, the shared
   components in 02-design-system §6, API client + query client + Zustand stores +
   WebSocket client + offline queue, auth screens + route guards + <Can>.
3. Modules in this order: 02-repair + 01-crm, then 07-billing + 03-pos, then 05-inventory
   + 06-procurement, then 04-amc, 08-commissions, 09-hr-payroll, 10-finance, then
   11-reports (dashboard stub early, full late), then 12-platform-admin.

PROCESS:
- First, output a concise build plan (folder tree + ordered task list) and WAIT for my "go"
  before mass-creating files.
- Then work ONE module at a time. After each: run typecheck + lint + `next build`, fix
  errors, tick off that module's Acceptance Criteria from its -ui.md, and make a single
  commit (e.g. "feat(repair): job board, detail, stages, estimates"). Then pause for review.
- If a frontend spec contradicts a backend contract, the backend contract wins — flag it,
  don't guess.
- Ask before touching anything outside the frontend or changing backend code.