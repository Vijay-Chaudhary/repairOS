# Module 01 — CRM (Frontend)

> Pairs with backend `modules/01-crm.md`. Leads pipeline, the 360° customer profile, communication logging, tasks, and segments.

## 1. Screens & routes
| Screen | Route | Reach |
|---|---|---|
| Leads pipeline | `/leads` | crm.leads.view |
| Customers list | `/customers` | crm.customers.view |
| Customer profile | `/customers/[id]` | crm.customers.view |
| Tasks | `/tasks` | crm.tasks.manage |
| Segments | `/settings/segments` | crm.segments.manage |

## 2. Navigation & layout
- **Leads**: Kanban by status (new→contacted→interested→quoted→converted/lost) with drag-to-advance; list toggle. Filters: source, assigned_to, date.
- **Customer profile**: header (name, phone, tags, credit limit, total billed/outstanding) + tabs: Repair history · Sales · AMC · Timeline · Tasks · Financial summary. The profile is the hub other modules deep-link into.

## 3. Components
`LeadKanban`, `CustomerSearch` (reused by Repair/POS/AMC), `CustomerProfileHeader`, `EntityTimeline` (filter by comm type), `LogCommunicationSheet`, `TaskList` + `TaskComposer`, `SegmentBuilder` (rule editor), `MergeCustomersDialog`, `TagInput`.

## 4. Forms & validation
- Lead create/edit; convert action (confirm) → creates/links customer.
- Customer create: phone E.164, unique (handle `DUPLICATE_PHONE` inline); business type reveals GSTIN field.
- Log communication: type, direction, summary (required), duration (calls).
- Task: title, due date/time, priority, assignee, optional link to customer/lead/job.
- Merge: pick source+target, preview repointed records, confirm (destructive).

## 5. States
Empty pipeline / customers → CTA. Profile tabs lazy-load each history list with skeletons + per-tab empty states. Duplicate phone → inline. Merge shows a clear before/after summary.

## 6. API wiring
`/leads/` (infinite) · `/leads/{id}/` · `/leads/{id}/convert/` · `/customers/` · `/customers/{id}/` · `/customers/{id}/timeline/` · `/customers/merge/` · `/communications/` · `/tasks/` · `/tasks/{id}/` · `/segments/` · `/segments/{id}/members/` · `/segments/{id}/bulk-whatsapp/`. Keys: `['leads',f]`, `['customers',f]`, `['customer',id]`, `['tasks',f]`.

## 7. Real-time
`task.due_soon` → toast + badge on Tasks nav. Bulk WhatsApp send shows progress toast.

## 8. Permissions in UI
Receptionist: create customers/leads + log comms (no merge, no segments). Convert/merge/segments gated. Technician: no CRM nav.

## 9. Mobile notes
Click-to-call and click-to-WhatsApp on phone numbers. Quick "log call" after tap-to-call. Pipeline columns swipeable.

## 10. Acceptance criteria
- [ ] Phone uniqueness enforced in UI; duplicate handled gracefully.
- [ ] Convert is one action, idempotent, lands on the new customer.
- [ ] Timeline aggregates all comm types chronologically, filterable.
- [ ] Merge previews repointed records before committing.
- [ ] Bulk WhatsApp respects opt-out (count excludes opted-out, shown to user).
