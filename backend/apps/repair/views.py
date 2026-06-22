"""
Repair module views — 14 API endpoints from modules/02-repair §6.
"""

import logging

from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from authentication.permissions import require_permission
from core.pagination import RepairOSCursorPagination, RepairOSPageNumberPagination
from crm.views import ShopScopedMixin

from . import services
from .models import (
    FaultTemplate,
    JobSparePartRequest,
    JobStage,
    JobTicket,
)
from .serializers import (
    AdvanceStageSerializer,
    CreateEstimateSerializer,
    EstimateResponseSerializer,
    FaultTemplateSerializer,
    JobCheckinConditionSerializer,
    JobSparePartRequestSerializer,
    JobStatusSerializer,
    JobTicketDetailSerializer,
    JobTicketListSerializer,
    JobTicketSerializer,
    RepairOverviewSerializer,
    ReviewSparePartSerializer,
    SetStagesSerializer,
    SparePartCreateSerializer,
    SparePartRequestListSerializer,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Job ticket viewset  (endpoints 6.1 – 6.13)
# ──────────────────────────────────────────────────────────────────────────────


class JobTicketViewSet(ShopScopedMixin, GenericViewSet):
    """
    GET    /jobs/                      — list
    POST   /jobs/                      — create
    GET    /jobs/{id}/                 — detail
    PATCH  /jobs/{id}/                 — update fields
    POST   /jobs/{id}/checkin/         — submit check-in form
    POST   /jobs/{id}/status/          — transition status
    POST   /jobs/{id}/stages/          — define / advance stages
    POST   /jobs/{id}/estimate/        — create + send estimate
    POST   /jobs/{id}/estimate/respond/— record customer response
    POST   /jobs/{id}/spare-parts/     — request a part
    POST   /jobs/{id}/warranty-claim/  — raise warranty claim
    POST   /jobs/{id}/attachments/     — upload attachment ref
    """

    pagination_class = RepairOSPageNumberPagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    # ── Permission routing ────────────────────────────────────────────────────

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [require_permission("repair.jobs.view")()]
        if self.action == "create":
            return [require_permission("repair.jobs.create")()]
        if self.action == "partial_update":
            return [require_permission("repair.jobs.edit")()]
        if self.action == "checkin":
            return [require_permission("repair.jobs.create")()]
        if self.action == "change_status":
            return [require_permission("repair.jobs.change_status")()]
        if self.action == "set_stages":
            return [require_permission("repair.jobs.assign_tech")()]
        if self.action in ("create_estimate", "respond_estimate"):
            perm = "repair.estimates.send" if self.action == "create_estimate" else "repair.estimates.approve"
            return [require_permission(perm)()]
        if self.action == "request_spare_part":
            return [require_permission("repair.spare_parts.request")()]
        if self.action == "warranty_claim":
            return [require_permission("repair.warranty.view")()]
        if self.action == "attachments":
            return [require_permission("repair.jobs.edit")()]
        return [require_permission("repair.jobs.view")()]

    # ── Queryset ──────────────────────────────────────────────────────────────

    def get_queryset(self):
        qs = (
            JobTicket.objects.filter(self._shop_filter())
            .select_related("customer", "shop", "created_by")
            .prefetch_related("stages__assigned_technician")
        )

        # Technicians (no assign_tech permission) see only their own jobs
        token = getattr(self.request, "auth", None)
        perms = token.get("permissions", []) if token else []
        if "repair.jobs.assign_tech" not in perms:
            qs = qs.filter(
                Q(created_by=self.request.user)
                | Q(stages__assigned_technician=self.request.user)
            ).distinct()

        # Query filters
        qp = self.request.query_params
        if s := qp.get("status"):
            qs = qs.filter(status=s)
        if shop_id := qp.get("shop_id"):
            qs = qs.filter(shop_id=shop_id)
        if tech_id := qp.get("technician_id"):
            qs = qs.filter(stages__assigned_technician_id=tech_id).distinct()
        if cust_id := qp.get("customer_id"):
            qs = qs.filter(customer_id=cust_id)
        if priority := qp.get("priority"):
            qs = qs.filter(priority=priority)
        if date_from := qp.get("date_from"):
            qs = qs.filter(intake_date__date__gte=date_from)
        if date_to := qp.get("date_to"):
            qs = qs.filter(intake_date__date__lte=date_to)

        # Search across key fields
        if search := qp.get("search", "").strip():
            qs = qs.filter(
                Q(job_number__icontains=search)
                | Q(customer__name__icontains=search)
                | Q(customer__phone__icontains=search)
                | Q(imei__icontains=search)
                | Q(serial_number__icontains=search)
                | Q(problem_description__icontains=search)
            ).distinct()

        # Device type
        if device_type := qp.get("device_type", "").strip():
            qs = qs.filter(device_type__iexact=device_type)

        # Payment status
        if payment_status := qp.get("payment_status", "").strip():
            if payment_status in ("paid", "partial", "unpaid"):
                from django.db.models import DecimalField, ExpressionWrapper, F
                qs = qs.annotate(
                    _balance=ExpressionWrapper(
                        F("service_charge") - F("advance_paid"),
                        output_field=DecimalField(),
                    )
                )
                if payment_status == "paid":
                    qs = qs.filter(_balance__lte=0)
                elif payment_status == "unpaid":
                    qs = qs.filter(advance_paid=0, service_charge__gt=0)
                elif payment_status == "partial":
                    qs = qs.filter(advance_paid__gt=0, _balance__gt=0)

        # Overdue: expected delivery in the past and not in a terminal state
        if qp.get("overdue", "").strip().lower() == "true":
            from django.utils import timezone
            qs = qs.filter(expected_delivery_date__lt=timezone.localdate()).exclude(
                status__in=["delivered", "closed", "cancelled"]
            )

        # Due on a specific date (expected delivery date)
        if due_on := qp.get("due_on", "").strip():
            qs = qs.filter(expected_delivery_date=due_on)

        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return JobTicketListSerializer
        if self.action == "retrieve":
            return JobTicketDetailSerializer
        return JobTicketSerializer

    # ── Standard CRUD ─────────────────────────────────────────────────────────

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        page = self.paginate_queryset(qs)
        serializer = self.get_serializer(page if page is not None else qs, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        vd = serializer.validated_data
        shop = vd.pop("shop")
        customer = vd.pop("customer")
        template = vd.pop("template", None)
        if template:
            vd["template"] = template

        job = services.create_job(shop, customer, vd, request.user)
        return Response(JobTicketSerializer(job).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        job = self._get_job(pk)
        return Response(JobTicketDetailSerializer(job).data)

    def partial_update(self, request, pk=None):
        job = self._get_job(pk)
        serializer = JobTicketSerializer(job, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data
        # Disallow status/job_number mutations via PATCH
        vd.pop("status", None)
        vd.pop("job_number", None)
        for attr, value in vd.items():
            setattr(job, attr, value)
        job.save()
        return Response(JobTicketSerializer(job).data)

    # ── Custom actions ────────────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="checkin")
    def checkin(self, request, pk=None):
        job = self._get_job(pk)
        serializer = JobCheckinConditionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        checkin = services.submit_checkin(job, serializer.validated_data, request.user)
        return Response(JobCheckinConditionSerializer(checkin).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="status")
    def change_status(self, request, pk=None):
        job = self._get_job(pk)
        serializer = JobStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = getattr(request, "auth", None) or {}
        is_tenant_wide = token.get("is_tenant_wide", False) if hasattr(token, "get") else False
        job = services.transition_job(
            job,
            serializer.validated_data["to_status"],
            request.user,
            serializer.validated_data.get("reason", ""),
            is_tenant_wide=is_tenant_wide,
        )
        return Response(JobTicketSerializer(job).data)

    @action(detail=True, methods=["post"], url_path="stages")
    def set_stages(self, request, pk=None):
        job = self._get_job(pk)
        serializer = SetStagesSerializer(data=request.data)
        if serializer.is_valid():
            # Define new stages
            services.set_stages(job, serializer.validated_data["stages"], request.user)
            return Response({"message": "Stages updated."})

        # Check if this is a stage advancement request
        advance_serializer = AdvanceStageSerializer(data=request.data)
        advance_serializer.is_valid(raise_exception=True)
        vd = advance_serializer.validated_data

        try:
            stage = job.stages.get(pk=vd["stage_id"])
        except JobStage.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Stage not found for this job.")

        stage = services.advance_stage(stage, vd["action"], vd.get("notes", ""), request.user)
        from .serializers import JobStageSerializer
        return Response(JobStageSerializer(stage).data)

    @action(detail=True, methods=["post"], url_path="estimate")
    def create_estimate(self, request, pk=None):
        job = self._get_job(pk)
        serializer = CreateEstimateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        estimate = services.create_estimate(job, dict(serializer.validated_data), request.user)

        from .serializers import JobEstimateSerializer as _JES
        data = _JES(estimate).data
        data["approval_link"] = f"https://app.repaiross.app/e/{estimate.id}"
        return Response(data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="estimate/respond")
    def respond_estimate(self, request, pk=None):
        job = self._get_job(pk)
        latest = job.estimates.filter(
            status__in=[JobEstimate.Status.SENT, JobEstimate.Status.DRAFT]
        ).order_by("-created_at").first()

        if not latest:
            from core.exceptions import BusinessRuleViolation
            raise BusinessRuleViolation("No pending estimate to respond to.")

        serializer = EstimateResponseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.respond_to_estimate(
            latest,
            serializer.validated_data["response"],
            serializer.validated_data["method"],
            request.user,
        )
        return Response(JobTicketDetailSerializer(job).data)

    @action(detail=True, methods=["post"], url_path="spare-parts")
    def request_spare_part(self, request, pk=None):
        job = self._get_job(pk)
        serializer = JobSparePartRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = dict(serializer.validated_data)
        vd.pop("requested_by", None)
        req = services.request_spare_part(job, vd, request.user)
        return Response(JobSparePartRequestSerializer(req).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="warranty-claim")
    def warranty_claim(self, request, pk=None):
        job = self._get_job(pk)
        warranty_job = services.create_warranty_claim(job, request.user)
        return Response(JobTicketSerializer(warranty_job).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="attachments")
    def attachments(self, request, pk=None):
        # S3 integration: client uploads directly; this endpoint stores the S3 key reference.
        # For now, return 200 with the provided key.
        key = request.data.get("key", "")
        return Response({"key": key, "message": "Attachment reference recorded."})

    @action(detail=True, methods=["get"], url_path="timeline")
    def timeline(self, request, pk=None):
        job = self._get_job(pk)
        from crm.models import CommunicationLog
        from crm.serializers import CommunicationLogSerializer
        # CommunicationLog has no `job` FK — it links to Customer/Lead — so a
        # job's timeline is the communication history of its customer.
        qs = CommunicationLog.objects.filter(customer_id=job.customer_id).order_by("-logged_at")
        page = self.paginate_queryset(qs)
        data = CommunicationLogSerializer(page if page is not None else qs, many=True).data
        if page is not None:
            return self.get_paginated_response(data)
        return Response({"items": data})

    # ── Helper ────────────────────────────────────────────────────────────────

    def _get_job(self, pk):
        try:
            return self.get_queryset().get(pk=pk)
        except JobTicket.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Job not found.")


# ──────────────────────────────────────────────────────────────────────────────
# Spare-part review  (endpoint 6.11)
# ──────────────────────────────────────────────────────────────────────────────


class SparePartRequestViewSet(ShopScopedMixin, GenericViewSet):
    """
    GET    /spare-parts/        — cross-job worklist (shop-scoped; filters: status, shop_id, date_from, date_to)
    POST   /spare-parts/        — create a job-linked spare-part request
    PATCH  /spare-parts/{id}/   — review (with `status`) or edit a still-'requested' item
    """

    pagination_class = RepairOSPageNumberPagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action == "partial_update" and "status" in self.request.data:
            return [require_permission("repair.spare_parts.approve")()]
        return [require_permission("repair.spare_parts.request")()]

    def _scoped_qs(self):
        qs = JobSparePartRequest.objects.select_related("job", "job__customer", "requested_by")
        token = getattr(self.request, "auth", None)
        if token and not (token.get("is_tenant_wide") or token.get("is_platform_admin")):
            shop_ids = token.get("shop_ids", [])
            qs = qs.filter(job__shop_id__in=shop_ids) if shop_ids else qs.none()
        return qs

    def get_queryset(self):
        return self._scoped_qs()

    def list(self, request):
        qs = self._scoped_qs()
        qp = request.query_params
        if s := qp.get("status"):
            qs = qs.filter(status=s)
        if shop_id := qp.get("shop_id"):
            qs = qs.filter(job__shop_id=shop_id)
        if df := qp.get("date_from"):
            qs = qs.filter(created_at__date__gte=df)
        if dt := qp.get("date_to"):
            qs = qs.filter(created_at__date__lte=dt)
        qs = qs.order_by("-created_at")
        page = self.paginate_queryset(qs)
        rows = page if page is not None else list(qs)
        serializer = SparePartRequestListSerializer(
            rows, many=True, context={"variant_labels": self._variant_labels(rows)}
        )
        return self.get_paginated_response(serializer.data) if page is not None else Response(serializer.data)

    @staticmethod
    def _variant_labels(rows):
        """Resolve {variant_id: display name} for variant-backed rows in one query."""
        variant_ids = [r.variant_id for r in rows if r.variant_id and not r.custom_part_name]
        if not variant_ids:
            return {}
        from inventory.models import ProductVariant
        return {
            v.id: str(v)
            for v in ProductVariant.objects.filter(id__in=variant_ids).select_related("product")
        }

    def create(self, request):
        from rest_framework.exceptions import NotFound
        serializer = SparePartCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = dict(serializer.validated_data)
        job_id = vd.pop("job_id")
        try:
            job = JobTicket.objects.filter(self._shop_filter()).get(pk=job_id)
        except JobTicket.DoesNotExist:
            raise NotFound("Job not found in your shops.")
        req = services.request_spare_part(job, vd, request.user)
        return Response(
            SparePartRequestListSerializer(req).data, status=status.HTTP_201_CREATED
        )

    def partial_update(self, request, pk=None):
        from rest_framework.exceptions import NotFound, ValidationError
        try:
            req = self.get_queryset().get(pk=pk)
        except JobSparePartRequest.DoesNotExist:
            raise NotFound("Spare part request not found.")

        # Review (status transition)
        if "status" in request.data:
            serializer = ReviewSparePartSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            vd = serializer.validated_data
            req = services.review_spare_part(req, vd["status"], request.user, vd.get("po_id"))
            return Response(SparePartRequestListSerializer(req).data)

        # Edit a still-'requested' item's fields
        if req.status != JobSparePartRequest.RequestStatus.REQUESTED:
            raise ValidationError("Only requested items can be edited.")
        editor = JobSparePartRequestSerializer(req, data=request.data, partial=True)
        editor.is_valid(raise_exception=True)
        for field in ("variant_id", "custom_part_name", "quantity", "is_urgent"):
            if field in editor.validated_data:
                setattr(req, field, editor.validated_data[field])
        req.save(update_fields=["variant_id", "custom_part_name", "quantity", "is_urgent", "updated_at"])
        return Response(SparePartRequestListSerializer(req).data)


# ──────────────────────────────────────────────────────────────────────────────
# Fault templates  (endpoint 6.14)
# ──────────────────────────────────────────────────────────────────────────────


class FaultTemplateViewSet(ShopScopedMixin, GenericViewSet):
    """
    GET    /fault-templates/       — list
    POST   /fault-templates/       — create (body includes nested parts[])
    PATCH  /fault-templates/{id}/  — update
    DELETE /fault-templates/{id}/  — soft-delete
    """

    pagination_class = RepairOSCursorPagination
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_permissions(self):
        return [require_permission("repair.templates.manage")()]

    def get_queryset(self):
        return FaultTemplate.objects.filter(self._shop_filter())

    def get_serializer_class(self):
        return FaultTemplateSerializer

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        if active := request.query_params.get("is_active"):
            qs = qs.filter(is_active=active.lower() == "true")
        page = self.paginate_queryset(qs)
        data = FaultTemplateSerializer(page if page is not None else qs, many=True).data
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)

    def create(self, request, *args, **kwargs):
        serializer = FaultTemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data
        shop = vd.pop("shop")
        parts_data = vd.pop("parts", [])
        template = services.create_fault_template(shop, vd, parts_data, request.user)
        return Response(FaultTemplateSerializer(template).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        try:
            template = self.get_queryset().get(pk=pk)
        except FaultTemplate.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Fault template not found.")
        serializer = FaultTemplateSerializer(template, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data
        # parts_data is None when "parts" key absent (don't touch existing parts)
        parts_data = vd.pop("parts", None)
        template = services.update_fault_template(template, vd, parts_data, request.user)
        return Response(FaultTemplateSerializer(template).data)

    def destroy(self, request, pk=None):
        try:
            template = self.get_queryset().get(pk=pk)
        except FaultTemplate.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Fault template not found.")
        template.is_active = False
        template.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)


# Import inside action to avoid circular import at module level
from .models import JobEstimate


# ──────────────────────────────────────────────────────────────────────────────
# Repair overview  (read-only dashboard hub)
# ──────────────────────────────────────────────────────────────────────────────


class RepairOverviewView(ShopScopedMixin, APIView):
    """GET /repair/overview/ — KPI counts, jobs-by-status, and a needs-attention list."""

    def get_permissions(self):
        return [require_permission("repair.jobs.view")()]

    def get(self, request):
        shop_id = request.query_params.get("shop_id")
        data = services.get_repair_overview(self._shop_filter(), shop_id)
        return Response(RepairOverviewSerializer(data).data)
