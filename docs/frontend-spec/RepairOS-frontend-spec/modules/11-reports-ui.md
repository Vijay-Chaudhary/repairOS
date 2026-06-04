# Module 11 — Reports & Dashboard (Frontend)

> Pairs with backend `modules/11-reports.md`. The live dashboard + the report catalogue with async export.

## 1. Screens & routes
| Screen | Route | Reach |
|---|---|---|
| Dashboard | `/dashboard` | any authenticated |
| Report catalogue | `/reports` | reports.{module}.view |
| Report view | `/reports/[type]` | reports.{module}.view |

## 2. Navigation & layout
Dashboard = grid of `KpiCard` + small charts, widgets gated by permission and scoped to active shop (or All shops). Report view = filter bar + table/chart + export button. Catalogue groups the 28 reports by module.

## 3. Components
`KpiCard`, `DashboardGrid`, chart wrappers (Recharts: line/bar/pie), `ReportFilters` (date range, shop, etc.), `ReportTable`, `ExportButton` (async job → poll → download), `ExportJobsTray`.

## 4. Forms & validation
Report filters per report (date range required where applicable). Export: choose PDF/CSV → creates `export_job` → tray shows progress → download when ready.

## 5. States
Each widget: skeleton → data → empty. Permission-less widgets simply absent. Export job: queued/processing/ready/failed in tray. Offline: dashboard from cache (banner), exports blocked.

## 6. API wiring
`GET /reports/{type}/` (JSON) · `GET /reports/{type}/export/` (→ export_job). Dashboard composes several report endpoints; key `['dashboard',shopId]`. Live widgets invalidated by WS events (foundation/03 §6).

## 7. Real-time
`job.status_changed`, `payment.received`, `stock.low_alert`, `task.due_soon`, AMC/budget signals refresh their widgets.

## 8. Permissions in UI
Each widget/report gated by its `reports.{module}.view`. Shop access filters data; "All shops" for tenant-wide roles.

## 9. Mobile notes
Dashboard as a vertical stack of KPI cards; charts simplified/scrollable; exports emailed/shared.

## 10. Acceptance criteria
- [ ] Widgets refresh by their specified mechanism; respect shop access.
- [ ] Reports honor filters; figures reconcile with source modules.
- [ ] Exports run async without blocking; download via signed URL.
