# Module 12 — Platform Admin & Onboarding (Frontend)

> Pairs with backend `modules/12-platform-admin.md`. The signup → provisioning → onboarding flow (tenant-facing) and the platform-admin console (Anthropic/operator-facing).

## 1. Screens & routes
| Screen | Route | Reach |
|---|---|---|
| Register | `/register` | public |
| Provisioning status | `/register/provisioning` | post-signup |
| Onboarding wizard | `/onboarding` | new Tenant Admin |
| Platform console | `/platform` | is_platform_admin |
| Tenants | `/platform/tenants` | is_platform_admin |
| Plans | `/platform/plans` | is_platform_admin |

## 2. Navigation & layout
**Onboarding wizard** (5 mandatory steps, can't dismiss): shop setup → branding → invite staff → commission rules → WhatsApp connect; ends on dashboard with "Create your first job". **Platform console** is a separate surface (own auth) listing tenants with db_status, plan, subscription, provisioning monitor.

## 3. Components
`RegisterForm` (slug live-check, password strength), `ProvisioningPoll` (animated, polls status), `OnboardingStepper`, `WhatsAppConnectStep` (+ test message), `TenantTable`, `PlanMatrixEditor`, `ProvisioningMonitor`.

## 4. Forms & validation
- Register: business name, slug (a-z/0-9/_, unique live), owner, phone, email, password (8+/upper/number/special). Email verify + phone OTP both required.
- Wizard steps mirror backend §4.3 (shop GST info, branding/bank, staff invite, commission defaults, WhatsApp number).
- Plan editor: limits + feature flags JSON.

## 5. States
Provisioning: "setting up…" with status polling; `provisioning_failed` → retry screen. Suspended tenant (non-payment) → blocked login with billing message. Plan-gated features show upgrade prompts where a feature is off.

## 6. API wiring
`POST /register/` · poll tenant status · `POST /platform/tenants/{id}/suspend/` · `GET /platform/tenants/` · `GET /platform/tenants/{id}/` · `GET|POST /platform/plans/`. Platform app subscribes master channel `tenant.db_provisioned`.

## 7. Real-time
`tenant.db_provisioned` → provisioning monitor updates (platform admin only).

## 8. Permissions in UI
Tenant onboarding = new Tenant Admin only. Platform console = `is_platform_admin`; strictly separate from tenant surfaces (no cross access).

## 9. Mobile notes
Onboarding fully mobile (owners sign up on phones). Platform console is desktop-first (operator tool).

## 10. Acceptance criteria
- [ ] Registration → provisioning status → wizard → first job within ~10 min.
- [ ] Wizard cannot be skipped; minimum config captured.
- [ ] Plan feature flags drive feature visibility/upgrade prompts.
- [ ] Platform admin cannot see tenant business data anywhere in UI.
