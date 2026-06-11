"""
Shared notification utilities.

send_whatsapp(phone, template_name, variables, customer=None)
  — Checks opt-out, dispatches core.dispatch_whatsapp_message via Celery.

send_email(to, subject, body, template_name="email")
  — Queues core.dispatch_email_message via Celery.
    Dev: console backend. Production: set EMAIL_BACKEND + EMAIL_HOST_*.

TEMPLATE_REGISTRY
  — Canonical list of all 31 WhatsApp templates + 2 email templates.
    GET /notifications/templates/ merges these defaults with DB overrides.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


# ── Template registry ────────────────────────────────────────────────────────

TEMPLATE_REGISTRY: list[dict[str, Any]] = [
    # Repair
    {"template_name": "job_received",            "module": "repair",    "trigger": "Job opened",              "recipient": "customer", "variables": ["customer_name", "job_number", "device_type", "shop_phone"]},
    {"template_name": "job_on_hold",             "module": "repair",    "trigger": "Job put on hold",         "recipient": "customer", "variables": ["customer_name", "job_number", "hold_reason", "shop_phone"]},
    {"template_name": "device_ready",            "module": "repair",    "trigger": "Device ready for pickup", "recipient": "customer", "variables": ["customer_name", "job_number", "device_type", "shop_address"]},
    {"template_name": "job_delivered",           "module": "repair",    "trigger": "Job delivered",           "recipient": "customer", "variables": ["customer_name", "job_number", "device_type"]},
    {"template_name": "cancellation_notice",     "module": "repair",    "trigger": "Job cancelled",           "recipient": "customer", "variables": ["customer_name", "job_number", "shop_phone"]},
    {"template_name": "repair_estimate",         "module": "repair",    "trigger": "Estimate sent",           "recipient": "customer", "variables": ["customer_name", "job_number", "device_type", "estimate_amount", "estimate_link"]},
    {"template_name": "estimate_approved_staff", "module": "repair",    "trigger": "Estimate approved",       "recipient": "staff",    "variables": ["staff_name", "job_number", "customer_name", "approved_amount"]},
    {"template_name": "stage_handoff",           "module": "repair",    "trigger": "Job stage transferred",   "recipient": "staff",    "variables": ["staff_name", "job_number", "from_stage", "to_stage", "device_type"]},
    {"template_name": "spare_part_request",      "module": "repair",    "trigger": "Part requested",          "recipient": "staff",    "variables": ["staff_name", "part_name", "job_number", "qty"]},
    {"template_name": "spare_part_received",     "module": "repair",    "trigger": "Part received",           "recipient": "staff",    "variables": ["staff_name", "part_name", "job_number", "qty"]},
    {"template_name": "warranty_expiry_reminder","module": "repair",    "trigger": "Warranty expiring",       "recipient": "customer", "variables": ["customer_name", "job_number", "device_type", "expiry_date", "shop_phone"]},
    # CRM
    {"template_name": "lead_assigned",           "module": "crm",       "trigger": "Lead assigned to staff",  "recipient": "staff",    "variables": ["staff_name", "lead_name", "lead_phone", "source"]},
    {"template_name": "lead_quote_sent",         "module": "crm",       "trigger": "Lead quote sent",         "recipient": "customer", "variables": ["customer_name", "quote_amount", "valid_until", "shop_phone"]},
    {"template_name": "task_overdue",            "module": "crm",       "trigger": "Task overdue",            "recipient": "staff",    "variables": ["staff_name", "task_title", "due_date"]},
    {"template_name": "task_daily_digest",       "module": "crm",       "trigger": "Daily task digest",       "recipient": "staff",    "variables": ["staff_name", "task_count", "task_list"]},
    # AMC
    {"template_name": "amc_visit_reminder",      "module": "amc",       "trigger": "Visit due tomorrow",      "recipient": "customer", "variables": ["customer_name", "contract_title", "visit_date", "tech_name"]},
    {"template_name": "amc_renewal_reminder",    "module": "amc",       "trigger": "Contract expiring soon",  "recipient": "customer", "variables": ["customer_name", "contract_title", "expiry_date", "renewal_value"]},
    {"template_name": "amc_visit_missed_alert",  "module": "amc",       "trigger": "Visit missed",            "recipient": "manager",  "variables": ["manager_name", "contract_title", "customer_name", "scheduled_date"]},
    {"template_name": "amc_visit_completed",     "module": "amc",       "trigger": "Visit completed",         "recipient": "customer", "variables": ["customer_name", "contract_title", "visit_date", "tech_name"]},
    {"template_name": "amc_renewal_invoice",     "module": "amc",       "trigger": "Renewal invoice raised",  "recipient": "customer", "variables": ["customer_name", "contract_title", "invoice_amount", "due_date"]},
    # POS
    {"template_name": "credit_note_issued",      "module": "pos",       "trigger": "Credit note issued",      "recipient": "customer", "variables": ["customer_name", "credit_note_number", "amount", "valid_until"]},
    {"template_name": "wholesale_payment_reminder", "module": "pos",    "trigger": "Outstanding balance",     "recipient": "customer", "variables": ["customer_name", "amount_due", "due_date", "shop_phone"]},
    # Inventory
    {"template_name": "low_stock_alert",         "module": "inventory", "trigger": "Stock below reorder level","recipient": "manager", "variables": ["item_name", "current_qty", "reorder_level"]},
    # HR
    {"template_name": "payroll_reminder",        "module": "hr",        "trigger": "Payroll due",             "recipient": "manager",  "variables": ["manager_name", "month", "year", "pending_count"]},
    {"template_name": "salary_slip_ready",       "module": "hr",        "trigger": "Salary slip approved",    "recipient": "staff",    "variables": ["staff_name", "month", "year", "net_pay"]},
    # Finance
    {"template_name": "petty_cash_low",          "module": "finance",   "trigger": "Petty cash below threshold","recipient": "manager","variables": ["shop_name", "current_balance", "threshold"]},
    {"template_name": "budget_exceeded",         "module": "finance",   "trigger": "Budget head exceeded",    "recipient": "manager",  "variables": ["head_name", "month", "year", "actual", "budgeted"]},
    # Billing
    {"template_name": "invoice_generated",       "module": "billing",   "trigger": "Invoice raised",          "recipient": "customer", "variables": ["customer_name", "invoice_number", "amount", "due_date"]},
    {"template_name": "payment_received",        "module": "billing",   "trigger": "Payment recorded",        "recipient": "customer", "variables": ["customer_name", "amount", "invoice_number"]},
    {"template_name": "payment_overdue",         "module": "billing",   "trigger": "Invoice overdue",         "recipient": "customer", "variables": ["customer_name", "invoice_number", "amount_due", "overdue_days"]},
    {"template_name": "gst_summary_ready",       "module": "billing",   "trigger": "Monthly GST summary",     "recipient": "manager",  "variables": ["manager_name", "month", "year", "total_gst"]},
    {"template_name": "commission_paid",         "module": "commissions","trigger": "Commission disbursed",   "recipient": "staff",    "variables": ["staff_name", "amount", "period"]},
    # Procurement — email channel
    {"template_name": "po_confirmation_supplier","module": "procurement","trigger": "PO sent to supplier",     "recipient": "supplier", "channel": "email", "variables": ["supplier_name", "po_number", "delivery_date", "total_value"]},
    {"template_name": "purchase_bill_due",       "module": "procurement","trigger": "Bill due in 3 days",      "recipient": "manager",  "channel": "email", "variables": ["manager_name", "supplier_name", "amount_due", "due_date"]},
]

_TEMPLATE_MAP: dict[str, dict[str, Any]] = {t["template_name"]: t for t in TEMPLATE_REGISTRY}


# ── Public API ────────────────────────────────────────────────────────────────

def send_whatsapp(
    phone: str,
    template_name: str,
    variables: dict[str, Any],
    customer=None,
) -> None:
    """
    Dispatch a WhatsApp template message asynchronously.

    Checks customer opt-out before queuing. The Celery task handles
    checking template is_active and calling Meta Cloud API.
    """
    if not phone:
        return
    if customer and getattr(customer, "whatsapp_optout", False):
        logger.debug("WhatsApp opt-out: skipping %s for %s", template_name, phone)
        return

    from core.tasks import dispatch_whatsapp_message  # avoid circular at module load
    dispatch_whatsapp_message.delay(phone=phone, template_name=template_name, variables=variables)


def send_email(
    to: str,
    subject: str,
    body: str,
    *,
    template_name: str = "email",
) -> None:
    """
    Queue a plain-text email via Celery.
    No-ops silently on empty address so callers don't need to guard.
    """
    if not to:
        return
    from core.tasks import dispatch_email_message  # avoid circular at module load
    dispatch_email_message.delay(to=to, subject=subject, body=body, template_name=template_name)
