"""
HR Celery tasks.

- generate_salary_pdf: triggered after slip approval; generates and uploads PDF.
- send_payroll_reminders: scheduled beat task reminding HR managers to run payroll.
"""

import logging

from config.celery import app

logger = logging.getLogger(__name__)


@app.task(name="hr.generate_salary_pdf", bind=True, max_retries=3, default_retry_delay=60)
def generate_salary_pdf(self, slip_id: str) -> None:
    """
    Generate and upload a PDF for an approved salary slip, then set pdf_url.
    PDF rendering requires WeasyPrint (not yet installed); logs a warning until
    the dependency is available.
    """
    from hr.models import SalarySlip

    try:
        slip = SalarySlip.objects.select_related("employee").get(id=slip_id)
    except SalarySlip.DoesNotExist:
        logger.error("generate_salary_pdf: SalarySlip %s not found", slip_id)
        return

    # TODO: integrate with WeasyPrint + file storage once the PDF infra is in place.
    logger.warning(
        "generate_salary_pdf: PDF generation not yet implemented (WeasyPrint not installed). "
        "slip_id=%s employee=%s %s/%s",
        slip_id, slip.employee.employee_code, slip.month, slip.year,
    )


@app.task(name="hr.send_payroll_reminders")
def send_payroll_reminders() -> None:
    """
    Remind HR managers on the 25th of each month to generate salary slips
    for the current month before the month-end cutoff.
    """
    from django.utils import timezone

    today = timezone.localdate()
    # Only remind on the 25th; beat runs daily so skip other days.
    if today.day != 25:
        return

    logger.info("send_payroll_reminders: payroll reminder triggered for %s/%s", today.month, today.year)
    # TODO: send WhatsApp/email to HR managers once notification infrastructure is in place.
