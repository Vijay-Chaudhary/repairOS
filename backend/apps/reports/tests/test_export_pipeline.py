"""
Tests for Pattern 9 — reports export pipeline (3-part lifecycle).

The audit identified three compounding failures that made all exports permanently break:
  (a) wrong request URL  → fixed: ?export=csv query param on any report endpoint
  (b) run_export task commented out → fixed: fully implemented in tasks.py
  (c) poll/detail endpoint missing → fixed: GET /api/v1/reports/export-jobs/<job_id>/

These tests exercise all three stages as a pipeline and pin the contract for each.

Stage A — Request:  GET /api/v1/reports/<slug>/?export=csv  → 202 + export_job_id
Stage B — Execute:  run_export Celery task → job.status=ready, file_url set
Stage C — Poll:     GET /api/v1/reports/export-jobs/<job_id>/ → status + file_url
"""

import tempfile
import os

import pytest
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken


# ── helpers ───────────────────────────────────────────────────────────────────

_REPORT_PERMS = [
    "reports.billing.view",
    "reports.repair.view",
    "reports.crm.view",
    "reports.hr.view",
    "reports.erp.view",
    "reports.amc.view",
]


def _make_client(user, shop_ids=None, is_tenant_wide=True):
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    access["permissions"] = _REPORT_PERMS
    access["shop_ids"] = [str(s) for s in (shop_ids or [])]
    access["is_tenant_wide"] = is_tenant_wide
    access["role_ids"] = []
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Export Shop", code="EXP",
        address="1 Export Rd", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919600000001",
    )


@pytest.fixture
def user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="export@test.com", phone="+919600000099",
        full_name="Export Tester", password="pass",
    )


@pytest.fixture
def other_user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="other@test.com", phone="+919600000098",
        full_name="Other Tester", password="pass",
    )


@pytest.fixture
def rpt_client(user, shop):
    return _make_client(user, shop_ids=[shop.id])


@pytest.fixture
def other_client(other_user, shop):
    return _make_client(other_user, shop_ids=[shop.id])


REVENUE_URL = "/api/v1/reports/revenue-summary/"
JOBS_URL = "/api/v1/reports/export-jobs/"


# ── Stage A: request export ───────────────────────────────────────────────────

@pytest.mark.django_db
class TestExportRequest:
    """Stage A — the ?export=csv query param triggers a 202 and creates an ExportJob."""

    def test_csv_export_returns_202(self, rpt_client):
        res = rpt_client.get(REVENUE_URL, {"export": "csv"})
        assert res.status_code == status.HTTP_202_ACCEPTED

    def test_csv_export_response_has_job_id(self, rpt_client):
        res = rpt_client.get(REVENUE_URL, {"export": "csv"})
        assert "export_job_id" in res.json()["data"]

    def test_initial_status_in_response_is_queued(self, rpt_client):
        """The view returns job.status as it was at creation, before the task runs."""
        res = rpt_client.get(REVENUE_URL, {"export": "csv"})
        assert res.json()["data"]["status"] == "queued"

    def test_export_triggers_job_creation_in_db(self, rpt_client, user):
        from reports.models import ExportJob
        res = rpt_client.get(REVENUE_URL, {"export": "csv", "date_from": "2026-01-01"})
        job_id = res.json()["data"]["export_job_id"]
        job = ExportJob.objects.get(id=job_id)
        assert job.report_type == "revenue-summary"
        assert job.format == "csv"
        assert job.requested_by == user

    def test_export_filters_stored_on_job(self, rpt_client):
        from reports.models import ExportJob
        res = rpt_client.get(REVENUE_URL, {
            "export": "csv",
            "date_from": "2026-01-01",
            "date_to": "2026-06-30",
        })
        job = ExportJob.objects.get(id=res.json()["data"]["export_job_id"])
        assert job.filters.get("date_from") == "2026-01-01"
        assert job.filters.get("date_to") == "2026-06-30"

    def test_unknown_report_slug_returns_404(self, rpt_client):
        res = rpt_client.get("/api/v1/reports/does-not-exist/", {"export": "csv"})
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_missing_permission_returns_403(self, user, shop):
        refresh = RefreshToken.for_user(user)
        access = refresh.access_token
        access["permissions"] = []
        access["shop_ids"] = [str(shop.id)]
        access["is_tenant_wide"] = True
        access["role_ids"] = []
        no_perm = APIClient()
        no_perm.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        res = no_perm.get(REVENUE_URL, {"export": "csv"})
        assert res.status_code == status.HTTP_403_FORBIDDEN


# ── Stage B: run_export task ──────────────────────────────────────────────────

@pytest.mark.django_db
class TestRunExportTask:
    """
    Stage B — CELERY_TASK_ALWAYS_EAGER=True (test settings) runs the task
    synchronously inside delay(). These tests verify the task drives the job
    to a terminal state and writes the output file.
    """

    def test_csv_job_reaches_ready_status(self, rpt_client):
        from reports.models import ExportJob
        res = rpt_client.get(REVENUE_URL, {"export": "csv"})
        job = ExportJob.objects.get(id=res.json()["data"]["export_job_id"])
        # With CELERY_TASK_ALWAYS_EAGER the task has already run
        assert job.status == ExportJob.Status.READY

    def test_ready_job_has_non_empty_file_url(self, rpt_client):
        from reports.models import ExportJob
        res = rpt_client.get(REVENUE_URL, {"export": "csv"})
        job = ExportJob.objects.get(id=res.json()["data"]["export_job_id"])
        assert job.file_url
        assert "/media/" in job.file_url

    def test_ready_job_has_completed_at_timestamp(self, rpt_client):
        from reports.models import ExportJob
        res = rpt_client.get(REVENUE_URL, {"export": "csv"})
        job = ExportJob.objects.get(id=res.json()["data"]["export_job_id"])
        assert job.completed_at is not None

    def test_file_url_ends_with_csv_extension(self, rpt_client):
        from reports.models import ExportJob
        res = rpt_client.get(REVENUE_URL, {"export": "csv"})
        job = ExportJob.objects.get(id=res.json()["data"]["export_job_id"])
        assert job.file_url.endswith(".csv")

    def test_csv_file_is_written_to_disk(self, rpt_client):
        """The task writes an actual file under MEDIA_ROOT/exports/."""
        from reports.models import ExportJob
        from django.conf import settings
        res = rpt_client.get(REVENUE_URL, {"export": "csv"})
        job = ExportJob.objects.get(id=res.json()["data"]["export_job_id"])
        rel_path = job.file_url.replace(settings.MEDIA_URL, "", 1)
        full_path = os.path.join(settings.MEDIA_ROOT, rel_path)
        assert os.path.isfile(full_path), f"Expected file at {full_path}"

    @override_settings(CELERY_TASK_EAGER_PROPAGATES=False)
    def test_invalid_report_type_in_task_sets_failed_status(self, user):
        """run_export with an unknown report_type catches the error and marks job FAILED."""
        from reports.models import ExportJob
        from reports.tasks import run_export
        job = ExportJob.objects.create(
            report_type="non-existent-report",
            format="csv",
            status=ExportJob.Status.QUEUED,
            requested_by=user,
            filters={},
        )
        run_export.apply(args=[str(job.id)])
        job.refresh_from_db()
        assert job.status == ExportJob.Status.FAILED

    @override_settings(CELERY_TASK_EAGER_PROPAGATES=False)
    def test_pdf_export_bad_template_sets_failed_status(self, user, settings):
        """run_export with a bad PDF template path catches the error and marks job FAILED."""
        from unittest.mock import patch
        from reports.models import ExportJob
        from reports.tasks import run_export

        job = ExportJob.objects.create(
            report_type="revenue-summary",
            format="pdf",
            status=ExportJob.Status.QUEUED,
            requested_by=user,
            filters={"shop_ids": []},
        )
        with patch("core.pdf.render_and_save_pdf", side_effect=RuntimeError("bad template")):
            run_export.apply(args=[str(job.id)])
        job.refresh_from_db()
        assert job.status == ExportJob.Status.FAILED


# ── Stage C: poll export job ──────────────────────────────────────────────────

@pytest.mark.django_db
class TestPollExportJob:
    """Stage C — GET /api/v1/reports/export-jobs/<job_id>/ is the polling endpoint."""

    def test_detail_returns_200(self, rpt_client):
        res_create = rpt_client.get(REVENUE_URL, {"export": "csv"})
        job_id = res_create.json()["data"]["export_job_id"]
        res = rpt_client.get(f"{JOBS_URL}{job_id}/")
        assert res.status_code == status.HTTP_200_OK

    def test_detail_returns_required_fields(self, rpt_client):
        res_create = rpt_client.get(REVENUE_URL, {"export": "csv"})
        job_id = res_create.json()["data"]["export_job_id"]
        data = rpt_client.get(f"{JOBS_URL}{job_id}/").json()["data"]
        for field in ("id", "report_type", "format", "status", "file_url", "created_at"):
            assert field in data, f"missing field: {field}"

    def test_detail_reflects_ready_status_after_task(self, rpt_client):
        res_create = rpt_client.get(REVENUE_URL, {"export": "csv"})
        job_id = res_create.json()["data"]["export_job_id"]
        data = rpt_client.get(f"{JOBS_URL}{job_id}/").json()["data"]
        assert data["status"] == "ready"
        assert data["file_url"]

    def test_detail_404_for_another_users_job(self, rpt_client, other_client):
        """A job owned by user A must not be readable by user B."""
        res = rpt_client.get(REVENUE_URL, {"export": "csv"})
        job_id = res.json()["data"]["export_job_id"]
        res_other = other_client.get(f"{JOBS_URL}{job_id}/")
        assert res_other.status_code == status.HTTP_404_NOT_FOUND

    def test_detail_404_for_nonexistent_job(self, rpt_client):
        import uuid
        res = rpt_client.get(f"{JOBS_URL}{uuid.uuid4()}/")
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_list_returns_items_and_meta(self, rpt_client):
        rpt_client.get(REVENUE_URL, {"export": "csv"})
        res = rpt_client.get(JOBS_URL)
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert "items" in data
        assert "meta" in data
        assert len(data["items"]) >= 1

    def test_list_only_shows_own_jobs(self, rpt_client, other_client):
        """Each user sees only their own export jobs."""
        rpt_client.get(REVENUE_URL, {"export": "csv"})
        other_client.get(REVENUE_URL, {"export": "csv"})

        my_jobs = rpt_client.get(JOBS_URL).json()["data"]["items"]
        other_jobs = other_client.get(JOBS_URL).json()["data"]["items"]

        my_ids = {j["id"] for j in my_jobs}
        other_ids = {j["id"] for j in other_jobs}
        assert my_ids.isdisjoint(other_ids), "Job lists must not overlap between users"


# ── Full pipeline integration ─────────────────────────────────────────────────

@pytest.mark.django_db
class TestFullPipeline:
    """End-to-end: create → poll → assert ready with download URL."""

    def test_create_poll_cycle_for_revenue_summary(self, rpt_client):
        # Step 1: request export
        res_a = rpt_client.get(REVENUE_URL, {
            "export": "csv",
            "date_from": "2026-01-01",
            "date_to": "2026-12-31",
        })
        assert res_a.status_code == status.HTTP_202_ACCEPTED
        job_id = res_a.json()["data"]["export_job_id"]
        assert job_id

        # Step 2: poll detail (task ran eagerly, so job is already terminal)
        res_b = rpt_client.get(f"{JOBS_URL}{job_id}/")
        assert res_b.status_code == status.HTTP_200_OK
        data = res_b.json()["data"]

        # Step 3: assert terminal state
        assert data["status"] == "ready"
        assert data["file_url"]
        assert data["report_type"] == "revenue-summary"
        assert data["format"] == "csv"
        assert data["completed_at"] is not None

    def test_create_poll_cycle_for_outstanding_dues(self, rpt_client):
        """Verify the pipeline works for a different report slug."""
        res_a = rpt_client.get("/api/v1/reports/outstanding-dues/", {"export": "csv"})
        assert res_a.status_code == status.HTTP_202_ACCEPTED
        job_id = res_a.json()["data"]["export_job_id"]
        data = rpt_client.get(f"{JOBS_URL}{job_id}/").json()["data"]
        assert data["status"] == "ready"

    def test_multiple_exports_all_appear_in_list(self, rpt_client):
        rpt_client.get(REVENUE_URL, {"export": "csv"})
        rpt_client.get("/api/v1/reports/outstanding-dues/", {"export": "csv"})
        items = rpt_client.get(JOBS_URL).json()["data"]["items"]
        assert len(items) == 2


# ── _data_to_csv unit tests ───────────────────────────────────────────────────

class TestDataToCsv:
    """Unit tests for the _data_to_csv helper (no DB required)."""

    def test_flattens_first_list_to_csv_rows(self):
        from reports.tasks import _data_to_csv
        data = {
            "total": "1000.00",
            "rows": [
                {"name": "Alice", "amount": "500.00"},
                {"name": "Bob",   "amount": "500.00"},
            ],
        }
        csv_out = _data_to_csv(data)
        assert "name" in csv_out       # header row
        assert "amount" in csv_out
        assert "Alice" in csv_out
        assert "Bob" in csv_out

    def test_returns_empty_string_when_no_list_value(self):
        from reports.tasks import _data_to_csv
        data = {"total": "0.00", "count": 0}
        assert _data_to_csv(data) == ""

    def test_returns_empty_string_for_empty_list(self):
        from reports.tasks import _data_to_csv
        data = {"rows": []}
        assert _data_to_csv(data) == ""

    def test_csv_has_correct_column_count(self):
        from reports.tasks import _data_to_csv
        import csv, io
        data = {"items": [{"a": 1, "b": 2, "c": 3}]}
        out = _data_to_csv(data)
        reader = csv.DictReader(io.StringIO(out))
        row = next(reader)
        assert set(row.keys()) == {"a", "b", "c"}

    def test_csv_header_row_matches_dict_keys(self):
        from reports.tasks import _data_to_csv
        data = {"invoices": [{"invoice_number": "INV-001", "amount": "1200.00"}]}
        lines = _data_to_csv(data).strip().splitlines()
        assert lines[0] == "invoice_number,amount"
        assert "INV-001" in lines[1]
