"""
Commissions Celery tasks.

generate_payout_pdf — renders a CommissionPayout summary PDF and sets payout.pdf_url.
"""

import logging

from config.celery import app

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


@app.task(name="commissions.generate_payout_pdf", bind=True, max_retries=3, default_retry_delay=60)
def generate_payout_pdf(self, payout_id: str, tenant_slug: str = "") -> None:
    """
    Render a commission payout PDF and persist the file URL on the payout row.

    Loads the payout + all its commission rows + job details in one query set,
    then calls core.pdf.render_and_save_pdf with the commission_payout template.
    """
    from core.context import clear_tenant_context
    from django.utils import timezone

    from commissions.models import CommissionPayout
    from core.pdf import render_and_save_pdf

    if tenant_slug:
        try:
            _set_tenant_context(tenant_slug)
        except Exception as exc:
            logger.error("generate_payout_pdf: cannot set tenant %s: %s", tenant_slug, exc)
            return

    try:
        try:
            payout = (
                CommissionPayout.objects
                .select_related("technician", "paid_by")
                .prefetch_related("commissions__job")
                .get(id=payout_id)
            )
        except CommissionPayout.DoesNotExist:
            logger.error("generate_payout_pdf: CommissionPayout %s not found", payout_id)
            return

        try:
            commission_rows = list(payout.commissions.select_related("job").order_by("created_at"))

            context = {
                "payout": payout,
                "commission_rows": commission_rows,
                "generated_at": timezone.now().strftime("%d %b %Y %H:%M"),
            }

            url = render_and_save_pdf(
                template_name="pdf/commission_payout.html",
                context=context,
                subdir="pdfs/payouts",
                filename=f"payout-{str(payout_id)[:8]}",
            )

            CommissionPayout.objects.filter(id=payout_id).update(pdf_url=url)
            logger.info("generate_payout_pdf: payout %s → %s", payout_id, url)

        except Exception as exc:
            logger.error("generate_payout_pdf: failed for payout %s: %s", payout_id, exc)
            raise self.retry(exc=exc)

    finally:
        if tenant_slug:
            clear_tenant_context()
