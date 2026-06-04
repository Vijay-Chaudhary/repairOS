# Foundation 03 — Conventions

> Cross-cutting rules every module obeys: API standards, response envelope, error registry, document numbering, GST determination, soft-delete, idempotency/webhooks, and the notification infrastructure.

---

## 1. API standards
- Base URL `https://api.repaiross.app/api/v1/`. JSON only. `Authorization: Bearer {access_token}`.
- Tenant from JWT `tenant_slug` — **never in the URL path**.
- Pagination: cursor-based for lists; limit-offset for report exports.
- Idempotency: `Idempotency-Key` header on payment + notification endpoints (§5).
- Versioning in path: `/api/v1/` stable; breaking changes → `/api/v2/`.

## 2. Response envelope
```jsonc
// success 200/201
{ "success": true, "data": { ... }, "meta": { "page": 1, "total": 142, "next_cursor": "..." } }
// error 4xx/5xx
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...",
                               "fields": { "phone": ["Required."] } } }
```

## 3. Error registry
| HTTP | Code | Meaning |
|---|---|---|
| 400 | VALIDATION_ERROR | schema validation; `fields` set |
| 400 | INVALID_CREDENTIALS / INVALID_OTP / WRONG_PASSWORD / PASSWORD_TOO_WEAK | auth |
| 400 | DUPLICATE_PHONE | customer/lead phone exists in tenant |
| 400 | INVALID_STATUS_TRANSITION | not in allowed transitions |
| 400 | INSUFFICIENT_STOCK | would breach stock CHECK ≥ 0 |
| 400 | CREDIT_LIMIT_EXCEEDED | wholesale credit blocked |
| 401 | NOT_AUTHENTICATED | no valid access token |
| 401 | REFRESH_TOKEN_INVALID / REFRESH_TOKEN_REUSE | refresh issues; reuse revokes family |
| 403 | PERMISSION_DENIED | missing permission codename |
| 404 | NOT_FOUND | absent or soft-deleted |
| 410 | OTP_EXPIRED | past 10-min window |
| 422 | BUSINESS_RULE_VIOLATION | rule violated; `message` explains |
| 422 | PROVISIONING_IN_PROGRESS | tenant DB still provisioning; retry 5 s |
| 423 | ACCOUNT_LOCKED | 5 fails; `locked_until` |
| 429 | OTP_RATE_LIMIT / RATE_LIMIT_EXCEEDED | throttle; Retry-After set |
| 500 | INTERNAL_ERROR | logged to Sentry |
| 503 | TENANT_DB_UNAVAILABLE | tenant DB unreachable; retry |

## 4. Document numbering (per tenant DB, per shop)
Generated atomically (per-shop counter row lock) to prevent duplicates.

| Document | Format | Scope |
|---|---|---|
| Repair Invoice | `{SHOP_CODE}-INV-{YYYY-MM}-{NNNN}` | shop/month |
| Sales Invoice (POS) | `{SHOP_CODE}-SALE-{YYYY-MM}-{NNNN}` | shop/month |
| Purchase Order | `{SHOP_CODE}-PO-{YYYY}-{NNNN}` | shop/year |
| GRN | `{SHOP_CODE}-GRN-{YYYY}-{NNNN}` | shop/year |
| Estimate | `{SHOP_CODE}-EST-{YYYY}-{NNNN}` | shop/year |
| AMC Contract | `{SHOP_CODE}-AMC-{YYYY}-{NNNN}` | shop/year |
| Credit Note | `{SHOP_CODE}-CN-{YYYY-MM}-{NNNN}` | shop/month |
| Debit Note | `{SHOP_CODE}-DN-{YYYY-MM}-{NNNN}` | shop/month |
| Job ticket | `{SHOP_CODE}-{YYYY}-{NNNN}` | shop/year |

## 5. GST determination
- Compare `shops.state_code` vs counterparty state_code (from GSTIN or address).
- **Same state** → CGST = rate/2, SGST = rate/2. **Different** → IGST = rate.
- No state data → default intra-state (CGST+SGST); billing staff may override.
- Labor uses **SAC** code; goods use **HSN** code.
- 🔧 GSTIN validation: **PROPOSED soft warning** on invalid 15-char format (not a hard block) — confirm (OQ-09).

## 6. Soft-delete (🔧 PROPOSED — global)
Mutable business tables carry `deleted_at TIMESTAMP NULL` + `deleted_by UUID NULL`. Default queries filter `deleted_at IS NULL`. "Delete" endpoints set these, not `DROP`. `404 NOT_FOUND` covers soft-deleted rows. Hard delete is prohibited via API (data-retention handled at platform level — OQ-02).

## 7. Idempotency & webhooks (🔧 PROPOSED — made real)
v3.1 required `Idempotency-Key` and signature-verified webhooks but modelled neither.

### 7.1 `idempotency_keys`
| Column | Type | Notes |
|---|---|---|
| key | VARCHAR(100) | PK — client-supplied |
| endpoint | VARCHAR(200) | NOT NULL |
| request_hash | VARCHAR(64) | SHA-256 of body |
| response_body | JSONB | cached response |
| status_code | INTEGER | |
| created_at | TIMESTAMP | DEFAULT NOW() — TTL 24 h |

Same key + same hash → return cached response. Same key + different hash → `422`.

### 7.2 `webhook_events` (dedup)
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| source | VARCHAR(20) | razorpay / whatsapp |
| external_id | VARCHAR(200) | UNIQUE — provider event id |
| signature_valid | BOOLEAN | NOT NULL |
| payload | JSONB | |
| processed_at | TIMESTAMP | NULL |

Signature verified before processing (Razorpay HMAC-SHA256, WhatsApp X-Hub-Signature-256); invalid → 403. Duplicate `external_id` ignored.

## 8. Notification infrastructure
WhatsApp via **Meta Cloud API** (no BSP). All sends async via Celery. Delivery status via `POST /webhooks/whatsapp/`. Retry 3× (5/15/45 min) → SMS fallback (MSG91). Opt-out: customer replies STOP → `customers.whatsapp_optout=TRUE`, checked before every send. Each tenant connects their own WhatsApp Business number at onboarding.

### 8.1 `notification_logs` (tenant DB)
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| customer_id | UUID | FK NULL |
| lead_id | UUID | FK NULL |
| template_name | VARCHAR(100) | NOT NULL |
| recipient_phone | VARCHAR(20) | NOT NULL |
| status | VARCHAR(20) | queued/sent/delivered/read/failed |
| whatsapp_message_id | VARCHAR(100) | NULL — Meta id |
| attempt_count | INTEGER | DEFAULT 0 |
| last_attempt_at / sent_at / delivered_at | TIMESTAMP | NULL |
| failed_reason | TEXT | NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |

The 31 templates are documented in their owning modules (§8 of each). This table is the shared log.

## 9. WebSocket (Channels)
Clients subscribe to `shop.{shop_id}` on login; only that shop's events arrive. Master channel (`tenant.db_provisioned`) is Platform-Admin only. Per-module events listed in each module §7.

## 10. Audit
Every create/update/delete on sensitive models writes to `audit_logs` (foundation/02 §2.7) with user, IP, user-agent, old/new JSON.
