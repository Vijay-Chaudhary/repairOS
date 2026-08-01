# Sales Invoice & Receipt Printing — Design

**Date:** 2026-08-01
**Status:** Approved (brainstormed with Vijay)

## Why

The request was "the sales module should generate and print an invoice." Investigating the
existing print path first turned up a larger problem: **document printing is broken everywhere,
including production.**

Clicking the PDF button on a repair invoice opens a blank page. The chain:

1. `backend/Dockerfile:9-13` installs only `libpq-dev`, `gcc` and `curl`. WeasyPrint's Python
   package is present but its native stack is not, so any render raises
   `OSError: cannot load library 'libgobject-2.0-0'`.
2. `billing.generate_invoice_pdf` therefore fails on every run, logs, retries, gives up — and
   `RepairInvoice.pdf_url` stays `''`. All 22 demo invoices are in this state.
3. `frontend/src/app/(app)/invoices/[id]/page.tsx:58-59` calls `window.open(pdf_url)` with no
   guard, so an empty string opens `about:blank`. That is the blank page.

Both the `dev` and `production` Dockerfile stages derive from the same base, so this is a
production defect, not a local-environment quirk. Salary slips, commission payouts and report
exports share the same pipeline and are equally broken.

A second, quieter gap: `TenantSettings` already stores `logo_url`, `invoice_footer` and bank
details, and **nothing reads them**. They appear in no PDF template and in no task context. Even a
working PDF today would print unbranded.

Sales have none of the pipeline at all — no template, no endpoint, no `pdf_url` — despite `Sale`
already carrying everything a tax invoice needs: `sale_number`, per-item data, CGST/SGST/IGST
split, discounts, customer, and a `Shop` with `gstin`, `state_code` and address.

This design fixes the shared pipeline and builds sales documents on top of it.

## Decisions (locked during brainstorming)

- **Two documents per sale**: an 80mm thermal receipt (browser print, no server involvement) and
  an A4 GST tax invoice (server-rendered PDF). Chosen at print time, not preconfigured.
- **The sale number is the invoice number.** `sale_number` is already unique and sequential per
  shop and year via `DocumentCounter`, which satisfies the consecutive-serial requirement. No
  second identifier, no new column on `Sale`.
- **Endpoints return PDF bytes, never a URL.** This removes the entire failure class above: there
  is no `pdf_url` string that can be empty and no `/media/` path that can 404.
- **Per-shop branding, editable**, falling back field-by-field to the tenant defaults.
- **No "amount in words"** on the invoice.
- **Inter-state sales print a single IGST line**; intra-state print CGST + SGST. The template
  follows the data already on `Sale`.
- **Guest (customer-less) sales get no tax invoice** — the button is hidden and the endpoint
  refuses. They still print a receipt.
- **Logo and signature stay URL strings.** No file-upload endpoint exists anywhere in the
  codebase; building one is explicitly out of scope (see Not in scope).

---

## 1. Architecture

```
GET /api/v1/pos/sales/<id>/invoice.pdf/        ← new
GET /api/v1/billing/repair-invoices/<id>/pdf/  ← changed: bytes, not {pdf_url}
     │
     ├─ stored file exists?  → stream from disk
     └─ missing or absent?   → render now, stream
                                 │
                          core/pdf.py
                          ├─ render_pdf_bytes(template, ctx)   ← new: bytes, no I/O
                          └─ render_and_save_pdf(...)          ← now wraps the above
                                 │
                          core/services/branding.py
                          resolve_branding(shop) →
                          ├─ Shop:           name, address, city, state, GSTIN, phone
                          ├─ ShopBranding:   logo, footer, bank, signature, show_hsn
                          └─ TenantSettings: fallback for logo, footer, bank
```

WeasyPrint is synchronous CPU work. The endpoints run it in a thread rather than blocking
Daphne's event loop.

**No staleness detection.** When a stored file is present it is served as-is; the endpoint does
not compare timestamps or re-render to check for drift. Regeneration stays the responsibility of
the existing `billing.generate_invoice_pdf` task, which already fires when an invoice is issued.
The on-demand branch is a fallback for *absent* files, not a cache-invalidation mechanism. Sales
invoices never hit this question — they are always rendered fresh and never stored.

### Work items

**1. `backend/Dockerfile`, base stage.** Add `libpango-1.0-0`, `libpangoft2-1.0-0`, `libcairo2`,
`libgdk-pixbuf-2.0-0`, `shared-mime-info`, plus `fonts-dejavu-core` and a Noto font so `₹` and
Indic customer names render as glyphs rather than boxes. Both stages inherit it.

**2. `core/pdf.py`.** Split rendering from storage. `render_pdf_bytes(template_name, context) ->
bytes` does the render; `render_and_save_pdf()` keeps its exact signature and return value and
becomes a thin wrapper, so salary slips, commission payouts and report exports are untouched.

**3. `core/services/branding.py`.** One `resolve_branding(shop) -> dict` consumed by every PDF
template context. Always returns a complete dict — absent values are `None`, never missing keys —
so templates guard with `{% if %}` and can never raise on a lookup.

**4. Media serving.** The stored-file consumers that are *not* invoices (salary slips, commission
payouts, report exports) still hand out `/media/...` URLs. `config/urls.py` never serves `/media/`
under `DEBUG`, and `infra/nginx/nginx.production.conf` has only a `/static/` location, with no
shared media volume between the Celery worker that writes files and anything that serves them.
Fix: a `static()` route under `DEBUG` in `config/urls.py`, and in production a `media_files`
volume mounted into `backend` and `celery-worker` with a matching `/media/` alias in the nginx
config. **This is the only change that touches production infrastructure.**

**5. Frontend.** `[ Print receipt ]` and `[ Tax invoice ]` on `/sales/[id]` and on the POS
post-checkout screen.

---

## 2. Data model

One new model, `core.ShopBranding`, one row per shop, every field optional:

| Field | Type | Blank means |
|---|---|---|
| `shop` | OneToOne → `core.Shop`, `related_name="branding"` | — |
| `logo_url` | CharField(500), blank | inherit `TenantSettings.logo_url` |
| `invoice_footer` | TextField, blank | inherit `TenantSettings.invoice_footer` |
| `bank_name` | CharField(200), blank | inherit tenant value |
| `bank_account_number` | CharField(50), blank | inherit tenant value |
| `bank_ifsc` | CharField(20), blank | inherit tenant value |
| `signature_url` | CharField(500), blank | no signature block printed |
| `show_hsn` | Boolean, default `True` | — |

**Resolution is field-by-field, not row-by-row.** A shop that overrides only its footer still
receives the tenant logo and bank block. A shop with no `ShopBranding` row behaves exactly as
today's tenant defaults, so existing tenants need no data migration.

Fallback order per field: shop value if non-blank → tenant value if non-blank → block omitted.

**Nothing changes on `Sale`** — no `pdf_url`, no invoice-number column. The only migration is an
additive `CreateModel` in `core`, reversible by construction, touching no existing column.

---

## 3. Documents

### 80mm thermal receipt (browser print)

Centred shop block (name, address, phone, GSTIN from `Shop`), sale number, date and time, sale
type and tender method, line items with quantity × rate, subtotal, GST split, total, amount
tendered, change, and the footer line from resolved branding. No logo and no bank block —
thermal paper renders neither well.

Implemented as a print-only container in the page, an `@media print` block sized to 80mm that
hides the application chrome, and `window.print()`. No endpoint, no server round-trip.

### A4 tax invoice (`templates/pdf/sales_invoice.html`)

- Branded header: logo, `TAX INVOICE`, sale number, status badge, date.
- Billed by (shop name, address, GSTIN, phone) and Billed to (customer name, address, GSTIN,
  place of supply from the customer's state code).
- Line table: #, description, HSN (column hidden when `show_hsn` is false), qty, rate, amount.
- Summary: subtotal, discount, then CGST + SGST **or** a single IGST line when
  `Sale.igst > 0`, then grand total.
- Bank block, signature line, footer text — each omitted when its resolved value is blank.

---

## 4. API surface

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /api/v1/pos/sales/<id>/invoice.pdf/` | `billing.sales_invoices.view` | New. Shop-scoped like `SaleViewSet`. |
| `GET /api/v1/billing/repair-invoices/<id>/pdf/` | unchanged | Behaviour change: returns the PDF, not `{"pdf_url": …}` |
| `GET`/`PATCH /api/v1/shops/<id>/branding/` | `settings.shop.edit` | New. PATCH creates the row on first save. |

No new permission slug. `billing.sales_invoices.view` already gates sale retrieval and is held by
Shop Manager, Billing Staff and Tenant Admin. Receptionist does not hold it, which matches the
intent: they take counter payments, they do not issue B2B tax invoices.

Responses set `Content-Type: application/pdf` and
`Content-Disposition: inline; filename="<sale_number>.pdf"`.

**The endpoint enforces what the UI hides.** Hiding the button is convenience, not a rule:

- 422 when the sale has no customer (guest sale).
- 422 when the sale is `draft` or `cancelled`.
- A `returned` sale still prints — the transaction happened, and the credit note is the
  counter-document.

### Frontend authentication detail

The PDF endpoint requires `Authorization: Bearer …` and `X-Tenant-Slug`, and `window.open()`
sends neither. The Tax Invoice button therefore cannot open a URL the way the current invoice page
does. It fetches through the normal `apiFetch` auth path, receives a blob, and opens an object
URL:

```
fetch(url, {headers}) → blob → URL.createObjectURL(blob) → window.open(objectUrl)
```

This also surfaces a real error instead of a silently blank tab — the actual fix for the reported
bug. The existing repair-invoice page is migrated to the same pattern.

---

## 5. Error handling

| Failure | Behaviour |
|---|---|
| WeasyPrint render or import fails | 500 with `PDF_RENDER_FAILED`; UI shows the message in a toast |
| Guest sale, or `draft` / `cancelled` sale | 422 `BusinessRuleViolation` |
| Sale belongs to another shop | 404 from the shop-scoped queryset |
| No `ShopBranding` row, or blank fields | Blocks omitted; `resolve_branding` always returns a complete dict |
| Stored repair-invoice PDF missing on disk | Falls through to on-demand render |
| Missing font glyphs | Prevented by the font packages in the image; tests assert real PDF bytes |

---

## 6. Testing

**Backend (pytest):**

- `render_pdf_bytes()` returns bytes beginning with `%PDF` — the check that would have caught the
  missing native libraries.
- `resolve_branding()`: shop override wins; blank field falls back to tenant; absent row behaves
  as tenant defaults; both blank omits the block.
- Sales invoice endpoint: 200 and `application/pdf` for a completed sale with a customer; 422 for
  guest, `draft` and `cancelled`; 403 without `billing.sales_invoices.view`; 404 cross-shop.
- Repair invoice endpoint returns PDF bytes when `pdf_url` is empty — regression test for the
  reported bug.
- Branding endpoint: GET returns resolved defaults, PATCH creates the row, gated on
  `settings.shop.edit`.

**Frontend (Vitest):**

- Tax invoice button hidden when `sale.customer_id` is null, shown otherwise.
- Clicking it fetches with auth and opens the object URL; a failed fetch shows an error toast and
  opens no window.
- Receipt container renders every line item and calls `window.print()`.
- Branding form PATCHes only changed fields.

`ci-known-failures.txt` is empty and CI already passes the PDF tests — GitHub's runners ship the
native libraries. The 10 PDF tests currently fail only in the local container; the image change
fixes that without touching CI config.

---

## 7. Not in scope

- **File uploads.** No upload endpoint exists in the codebase; `logo_url` and `signature_url`
  remain URL strings entered by hand. An upload widget is a separate piece of work.
- **Per-shop template variants or field toggles beyond `show_hsn`.** One layout, different
  content.
- **Converting salary slips, commission payouts and report exports to byte-streaming endpoints.**
  They keep their `pdf_url` pattern and are unblocked by the image and media-serving fixes alone.
- **Populating `pos.CreditNote.pdf_url`.** That column exists and nothing writes it; credit-note
  PDFs are a follow-up.
- **E-invoice / IRN / QR-code generation** under the GST e-invoicing mandate.

## 8. Suggested staging

The work is coherent as one design but large for a single review. Natural split:

1. **Pipeline fix** — Dockerfile libs, `render_pdf_bytes()` split, media serving, both invoice
   endpoints streaming bytes, frontend blob-fetch helper. Verifiable on its own: the repair
   invoice button starts working.
2. **Branding** — `ShopBranding` model, `resolve_branding()`, settings endpoint and form, wired
   into the existing repair invoice template.
3. **Sales documents** — `sales_invoice.html`, the sales endpoint, the receipt print path, and
   the two buttons.

Each stage leaves the app in a working state and can ship independently.

## 9. Verification

After implementation, on the local stack:

1. Rebuild the backend image and confirm `python -c "import weasyprint"` succeeds in both the
   backend and celery-worker containers.
2. Open a repair invoice and click the PDF button — a PDF renders instead of a blank page.
3. Complete a counter sale in POS; print the receipt; confirm the 80mm layout in the browser's
   print preview.
4. Complete a sale with a business customer; print the tax invoice; confirm shop details, GSTIN,
   HSN column and GST split.
5. Set a shop-level footer and bank account in Settings → Shops; reprint; confirm the override
   appears and the tenant logo still does.
6. Confirm the tax invoice button is absent on a guest sale, and that calling the endpoint
   directly for that sale returns 422.
