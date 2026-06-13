"""
Reports async export tasks.

run_export: process a queued ExportJob — call the report service, serialize
to CSV or PDF (WeasyPrint), save to MEDIA_ROOT, and update job.file_url + status.
"""

import csv
import io
import logging
import os
import uuid

from celery import shared_task
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


def _data_to_csv(data: dict) -> str:
    """Flatten the first array in a report data dict to CSV."""
    # Find the first list value — that's the rows
    rows = None
    for v in data.values():
        if isinstance(v, list):
            rows = v
            break

    if not rows:
        return ""

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()) if rows else [])
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def _ensure_tenant_db(tenant_slug: str) -> str:
    """Register the tenant DB connection in the worker process if not already registered."""
    from django.db import connections
    from master.models import TenantDatabase

    alias = f"tenant_{tenant_slug}"
    if alias not in connections.databases:
        tdb = TenantDatabase.objects.using("default").select_related("tenant").get(
            tenant__slug=tenant_slug
        )
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
    return alias


@shared_task(bind=True, max_retries=3, default_retry_delay=30, name="reports.tasks.run_export")
def run_export(self, job_id: str, tenant_slug: str = "") -> None:
    from core.context import set_tenant_db_alias, clear_tenant_context
    from reports.models import ExportJob
    from reports import services
    from reports.views import REPORT_REGISTRY

    if tenant_slug:
        try:
            alias = _ensure_tenant_db(tenant_slug)
            set_tenant_db_alias(alias)
        except Exception as exc:
            logger.error("run_export: cannot set tenant context for %s: %s", tenant_slug, exc)
            return

    try:
        job = ExportJob.objects.get(id=job_id)
    except ExportJob.DoesNotExist:
        logger.error("run_export: ExportJob %s not found", job_id)
        if tenant_slug:
            clear_tenant_context()
        return

    job.status = ExportJob.Status.PROCESSING
    job.save(update_fields=["status"])

    try:
        entry = REPORT_REGISTRY.get(job.report_type)
        if not entry:
            raise ValueError(f"Unknown report type: {job.report_type}")

        _, fn = entry
        shop_ids = job.filters.get("shop_ids", [])

        if job.format == ExportJob.Format.CSV:
            # Special case: GSTR reports already produce CSV natively
            if job.report_type == "gstr-1":
                from datetime import date
                from reports import services as svc
                month = int(job.filters.get("month", date.today().month))
                year = int(job.filters.get("year", date.today().year))
                content = svc.gstr1_csv(shop_ids, month, year)
            elif job.report_type == "gstr-2":
                from datetime import date
                from reports import services as svc
                month = int(job.filters.get("month", date.today().month))
                year = int(job.filters.get("year", date.today().year))
                content = svc.gstr2_proxy_csv(shop_ids, month, year)
            else:
                data = fn(shop_ids, job.filters)
                content = _data_to_csv(data)

            ext = "csv"
            mode = "w"

        else:
            # PDF export via WeasyPrint
            data = fn(shop_ids, job.filters)

            # Extract the first list in the data dict as rows
            rows = None
            for v in data.values():
                if isinstance(v, list) and v:
                    rows = v
                    break

            from django.utils import timezone as tz
            from core.pdf import render_and_save_pdf

            title = job.report_type.replace("-", " ").title()
            context = {
                "title": title,
                "rows": rows or [],
                "columns": list(rows[0].keys()) if rows else [],
                "generated_at": tz.now().strftime("%d %b %Y %H:%M"),
                "date_from": job.filters.get("date_from", ""),
                "date_to": job.filters.get("date_to", ""),
            }

            file_url = render_and_save_pdf(
                template_name="pdf/report_export.html",
                context=context,
                subdir="exports",
                filename=f"{job.report_type}-{uuid.uuid4().hex[:10]}",
            )

            job.file_url = file_url
            job.status = ExportJob.Status.READY
            job.completed_at = timezone.now()
            job.save(update_fields=["file_url", "status", "completed_at"])
            logger.info("run_export: PDF job %s ready at %s", job_id, file_url)
            return

        # Save CSV to MEDIA_ROOT
        rel_path = f"exports/{job.report_type}-{uuid.uuid4().hex[:10]}.{ext}"
        full_path = os.path.join(settings.MEDIA_ROOT, rel_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, mode, encoding="utf-8") as f:
            f.write(content)

        job.file_url = f"{settings.MEDIA_URL}{rel_path}"
        job.status = ExportJob.Status.READY
        job.completed_at = timezone.now()
        job.save(update_fields=["file_url", "status", "completed_at"])
        logger.info("run_export: job %s ready at %s", job_id, job.file_url)

    except Exception as exc:
        logger.exception("run_export: job %s failed: %s", job_id, exc)
        job.status = ExportJob.Status.FAILED
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "completed_at"])
        raise self.retry(exc=exc) if self.request.retries < self.max_retries else exc
    finally:
        if tenant_slug:
            clear_tenant_context()
