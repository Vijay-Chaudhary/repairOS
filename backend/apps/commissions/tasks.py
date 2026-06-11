"""
Commissions Celery tasks.

generate_payout_pdf — renders a CommissionPayout summary PDF and sets payout.pdf_url.
"""

import logging

from config.celery import app

logger = logging.getLogger(__name__)


@app.task(name="commissions.generate_payout_pdf", bind=True, max_retries=3, default_retry_delay=60)
def generate_payout_pdf(self, payout_id: str) -> None:
    """
    Render a commission payout PDF and persist the file URL on the payout row.

    Loads the payout + all its commission rows + job details in one query set,
    then calls core.pdf.render_and_save_pdf with the commission_payout template.
    """
    from django.utils import timezone

    from commissions.models import CommissionPayout
    from core.pdf import render_and_save_pdf

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
