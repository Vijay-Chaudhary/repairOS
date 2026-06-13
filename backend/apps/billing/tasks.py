"""
Billing async tasks.

generate_invoice_pdf: renders a RepairInvoice to PDF via WeasyPrint,
  saves under MEDIA_ROOT, and writes back invoice.pdf_url.
"""

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


def _set_tenant_context(tenant_slug: str) -> None:
    from django.db import connections
    from core.context import set_tenant_db_alias
    from master.models import TenantDatabase

    alias = f"tenant_{tenant_slug}"
    if alias not in connections.databases:
        tdb = TenantDatabase.objects.using("default").get(tenant__slug=tenant_slug)
        connections.databases[alias] = {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": tdb.db_name,
            "HOST": tdb.db_host,
            "PORT": str(tdb.db_port),
            "USER": tdb.db_user,
            "PASSWORD": tdb.decrypt_password(),
            "CONN_MAX_AGE": 0,
            "CONN_HEALTH_CHECKS": False,
            "OPTIONS": {},
            "TIME_ZONE": None,
            "ATOMIC_REQUESTS": False,
            "AUTOCOMMIT": True,
            "TEST": {},
        }
    set_tenant_db_alias(alias)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    name="billing.generate_invoice_pdf",
)
def generate_invoice_pdf(self, invoice_id: str, tenant_slug: str = "") -> None:
    from core.context import clear_tenant_context

    if tenant_slug:
        try:
            _set_tenant_context(tenant_slug)
        except Exception as exc:
            logger.error("generate_invoice_pdf: cannot set tenant %s: %s", tenant_slug, exc)
            return

    try:
        from .models import RepairInvoice

        try:
            invoice = (
                RepairInvoice.objects.select_related("job", "customer", "shop")
                .prefetch_related("items")
                .get(id=invoice_id)
            )
        except RepairInvoice.DoesNotExist:
            logger.error("generate_invoice_pdf: invoice %s not found", invoice_id)
            return

        from core.pdf import render_and_save_pdf
        from django.utils import timezone

        context = {
            "invoice": invoice,
            "shop": invoice.shop,
            "items": invoice.items.all(),
            "generated_at": timezone.now().strftime("%d %b %Y %H:%M"),
        }

        file_url = render_and_save_pdf(
            template_name="pdf/repair_invoice.html",
            context=context,
            subdir="invoices",
            filename=f"invoice-{invoice.invoice_number.replace('/', '-')}",
        )

        invoice.pdf_url = file_url
        invoice.save(update_fields=["pdf_url", "updated_at"])
        logger.info("Invoice PDF ready: %s → %s", invoice.invoice_number, file_url)

    except Exception as exc:
        logger.exception("generate_invoice_pdf failed for invoice %s: %s", invoice_id, exc)
        raise self.retry(exc=exc) if self.request.retries < self.max_retries else exc

    finally:
        if tenant_slug:
            clear_tenant_context()
