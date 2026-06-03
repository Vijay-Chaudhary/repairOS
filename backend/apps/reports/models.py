"""
Reports module — ExportJob model only.

No business tables. ExportJob tracks async PDF/CSV export lifecycle.
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import BaseModel


class ExportJob(BaseModel):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        PROCESSING = "processing", "Processing"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    class Format(models.TextChoices):
        PDF = "pdf", "PDF"
        CSV = "csv", "CSV"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report_type = models.CharField(max_length=100)
    filters = models.JSONField(default=dict)
    format = models.CharField(max_length=10, choices=Format.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED)
    file_url = models.CharField(max_length=500, blank=True, default="")
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="export_jobs",
    )
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = "reports"
        db_table = "export_jobs"
        indexes = [
            models.Index(fields=["requested_by", "status"]),
            models.Index(fields=["report_type", "status"]),
        ]

    def __str__(self) -> str:
        return f"ExportJob {self.report_type} ({self.status})"
