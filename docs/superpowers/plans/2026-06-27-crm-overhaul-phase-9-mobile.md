# CRM Overhaul — Phase 9: Mobile affordances — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make phone numbers actionable on mobile: `tel:` (click-to-call) and `wa.me` (click-to-WhatsApp) links on phone numbers across `LeadCard`, the customer list, and `CustomerProfileHeader`; plus a quick **"Log call"** affordance that opens the existing `LogCommunicationSheet` (already defaults to `type=call`). The final phase of the CRM overhaul — frontend only.

**Architecture:** Extract a small shared `PhoneActions` component (tel: + wa.me + optional "Log call" button) and wire it into the three surfaces, replacing today's ad-hoc `tel:` markup. Reuse `normalizePhone` (`lib/format/phone.ts`) for the `tel:`/`wa.me` targets and `formatPhone` for display. The quick-log flow reuses `LogCommunicationSheet` — **no new logging component** (spec).

**Tech Stack:** Next.js 14 + TS + React Query (Vitest).

**Source spec:** `docs/superpowers/specs/2026-06-24-crm-overhaul-design.md` (Phase 9).

---

## Key facts (verified against the codebase)

- `lib/format/phone.ts` exports `formatPhone` (display) and `normalizePhone` (→ `+91…` E.164). `wa.me` wants digits only: `normalizePhone(phone).replace(/\D/g,'')`.
- `LogCommunicationSheet` (`components/crm/LogCommunicationSheet.tsx`) `defaultValues: { type: 'call', direction: 'inbound', summary: '' }` and `form.reset()` on success → it always opens on **call**. Opening it satisfies "prefilled with type=call"; no change needed there.
- `LeadCard` (`components/crm/LeadCard.tsx`) already renders a `tel:` link and already mounts `<LogCommunicationSheet open={logCommOpen} … leadId={lead.id}>`; there's a `setLogCommOpen` available. Missing: `wa.me` + a quick "Log call" button.
- `CustomerProfileHeader` (`components/crm/CustomerProfileHeader.tsx`) has `tel:` + `wa.me` **but with an invalid nested `<a>` inside `<a>`** (the wa.me anchor is a child of the tel anchor) — fix by replacing with `PhoneActions`. It already mounts `LogCommunicationSheet` (`customerId`) with `setLogCommOpen`.
- Customers list (`app/(app)/customers/page.tsx`) `LIST_COLUMNS` name cell has a `tel:` link only. Rows have no per-row sheet → add `tel:` + `wa.me` links (no quick-log there; clicking the row opens the profile, which has it). All cell click targets already `stopPropagation` so row navigation isn't triggered.
- Icons available in `lucide-react`: `Phone`, `MessageCircle` (WhatsApp), `PhoneOutgoing` (log call).
- `LeadCard.test.tsx` does not assert on the phone link — safe to refactor the markup.

## File structure

```
frontend/src/
  components/shared/PhoneActions.tsx                 # NEW
  components/shared/__tests__/phoneActions.test.tsx  # NEW
  components/crm/LeadCard.tsx                         # use PhoneActions (+ onLogCall)
  components/crm/CustomerProfileHeader.tsx            # use PhoneActions (fix nested <a>, + onLogCall)
  app/(app)/customers/page.tsx                        # use PhoneActions in the name cell
```

---

## Steps

- [x] **Step 1: `PhoneActions` (TDD)**
  - Test (`phoneActions.test.tsx`): renders a `tel:` link with the normalized number; renders a `wa.me` link to the digit string; hides the wa.me link when `whatsappOptout`; renders a "Log call" button that calls `onLogCall` when `onLogCall` is provided (and omits it otherwise).
  - Impl: `PhoneActions({ phone, whatsappOptout?, onLogCall?, muted?, className? })` — inline flex: `tel:` anchor (`Phone` icon + `formatPhone`), `wa.me` anchor (`MessageCircle`, `target=_blank rel=noreferrer`, `aria-label="WhatsApp {formatted}"`) unless `whatsappOptout`, and an optional `PhoneOutgoing` button (`aria-label="Log call"`). All interactive els `stopPropagation` so they're safe inside clickable rows/cards.

- [x] **Step 2: Wire into `LeadCard`** — replace the existing `tel:` block with `<PhoneActions phone={lead.phone} onLogCall={() => setLogCommOpen(true)} />`. Keep the existing `LogCommunicationSheet`.

- [x] **Step 3: Wire into `CustomerProfileHeader`** — replace the buggy nested-anchor phone block with `<PhoneActions phone={customer.phone} whatsappOptout={customer.whatsapp_optout} onLogCall={() => setLogCommOpen(true)} />`; render `alternate_phone` (if any) as a second `<PhoneActions muted>` (no wa/log or muted styling). Keep the header's existing "Log comm" button + sheet.

- [x] **Step 4: Wire into customers list** — replace the name-cell `tel:` anchor with `<PhoneActions phone={r.phone} muted />` (links only; no quick-log in the table).

- [x] **Step 5: Tests + type-check**
  - Run: `cd frontend && npx vitest run src/components/shared/__tests__/phoneActions.test.tsx src/components/crm/__tests__/LeadCard.test.tsx 2>&1 | tail -8` → PASS.
  - Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo OK` → `OK`.

- [x] **Step 6: Commit + PR** on `feat/crm-overhaul-phase-9-mobile` (commit only Phase 9 files; leave deployment WIP untouched). → PR #18.

---

## Final verification

- [x] **Frontend** — full `npx vitest run` green (90/90); `tsc --noEmit … || echo OK` → `OK`.
- [x] **No backend change** — confirmed no edits under `backend/`.
- [ ] **Manual smoke — live UI** (needs Docker, mobile/responsive): tap a number on a lead card / customer row / profile → dialer opens; WhatsApp icon → wa.me; "Log call" → LogCommunicationSheet opens on the Call type.

---

## Notes / risks

- **Bug fix included** — the existing nested `<a>` in `CustomerProfileHeader` is invalid HTML (hydration-fragile); replacing it with `PhoneActions` resolves it.
- **No quick-log in the customers table** — table rows have no per-row sheet; the profile page (one tap away) carries the log-call affordance. Spec's "across LeadCard, customer list, CustomerProfileHeader" refers to the tel:/wa.me links, which all three get.
- **`LogCommunicationSheet` already defaults to call** — opening it is the prefill; no prop added.
- **Final phase** — closes out the CRM overhaul (Phases 1–9).
