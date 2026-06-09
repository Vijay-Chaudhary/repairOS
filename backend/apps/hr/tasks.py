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

    from authentication.models import User
    from core.notifications import send_whatsapp

    # Notify all active HR managers (is_platform_admin excluded — tenant users only).
    hr_managers = User.objects.filter(is_active=True, is_platform_admin=False)
    pending_count = _count_pending_slips(today.month, today.year)

    for manager in hr_managers:
        send_whatsapp(
            phone=manager.phone,
            template_name="payroll_reminder",
            variables={
                "manager_name": manager.full_name,
                "month": str(today.month),
                "year": str(today.year),
                "pending_count": str(pending_count),
            },
        )


def _count_pending_slips(month: int, year: int) -> int:
    try:
        from hr.models import Employee, SalarySlip
        total = Employee.objects.filter(is_active=True).count()
        done = SalarySlip.objects.filter(month=month, year=year).count()
        return max(0, total - done)
    except Exception:
        return 0
