# RepairOS — Project Context for Claude

## What is this?
Multi-tenant SaaS platform for repair shop management.
Stack: Django + DRF (backend), Next.js + TypeScript (frontend), PostgreSQL, Celery, Redis.
Architecture: Database-per-tenant, automatic provisioning, PWA-only deployment.

## Backend Rules
- Python 3.11+, Django 4.2+, DRF
- Every API endpoint needs serializer + permission_classes + tests
- Business logic in services.py — never in views
- Use select_related/prefetch_related — no N+1 queries
- Celery for async tasks
- django-environ for all settings — no hardcoded secrets

## Frontend Rules
- Next.js 14+ App Router only — no Pages Router
- TypeScript strict mode always
- Tailwind CSS for all styling
- Mobile-first, PWA — service worker + manifest.json
- React Query for server state
- Zustand for client state

## Database
- PostgreSQL — one DB per tenant
- Migrations must be reversible
- Never drop columns directly — deprecate first

## Testing
- Backend: pytest + pytest-django
- Frontend: Vitest + React Testing Library
- Every new feature needs tests before merging

## Modules
- CRM, Repair, ERP, POS, AMC, Billing/GST
- 100+ API endpoints
- 31 WhatsApp notification templates
- Multi-tenant with automatic provisioning

## Do NOT
- No hardcoded tenant IDs
- No raw SQL unless absolutely necessary
- No console.log in production code
- No any type in TypeScript
