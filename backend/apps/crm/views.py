"""
CRM views — all 13 endpoints from foundation/modules/01-crm §6.
Business logic lives in services.py; views only handle HTTP plumbing.
"""

import logging

from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.mixins import (
    CreateModelMixin,
    ListModelMixin,
    RetrieveModelMixin,
    UpdateModelMixin,
)
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from authentication.permissions import require_permission
from core.pagination import RepairOSCursorPagination, RepairOSPageNumberPagination

from . import services
from .models import (
    Campaign,
    CommunicationLog,
    Customer,
    CustomerSegment,
    CustomerSegmentMember,
    FollowUpTask,
    Lead,
)
from .serializers import (
    BulkWhatsAppSerializer,
    CampaignCreateSerializer,
    CampaignSerializer,
    CommunicationLogSerializer,
    CrmOverviewSerializer,
    CustomerMergeSerializer,
    CustomerSegmentMemberSerializer,
    CustomerSegmentSerializer,
    CustomerSerializer,
    FollowUpTaskSerializer,
    LeadQuoteSerializer,
    LeadSerializer,
    LeadStatusSerializer,
    SendQuoteSerializer,
    TaskCompleteSerializer,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Mixin: shop-scoped queryset filtering
# ──────────────────────────────────────────────────────────────────────────────


class ShopScopedMixin:
    """
    Restricts querysets to shops the authenticated user can access.

    If the JWT carries `is_tenant_wide: true` (Tenant Admin or tenant-wide role),
    no shop filter is applied. Otherwise filters to the `shop_ids` list in the JWT.
    """

    def _shop_filter(self) -> Q:
        token = getattr(self.request, "auth", None)
        if token is None:
            return Q(pk__in=[])

        if token.get("is_tenant_wide") or token.get("is_platform_admin"):
            return Q()

        shop_ids = token.get("shop_ids", [])
        if not shop_ids:
            return Q(pk__in=[])
        return Q(shop_id__in=shop_ids)


# ──────────────────────────────────────────────────────────────────────────────
# Lead viewset
# ──────────────────────────────────────────────────────────────────────────────


class LeadViewSet(ShopScopedMixin, ModelViewSet):
    """
    GET    /leads/         — list (filter: status, assigned_to, shop_id)
    POST   /leads/         — create
    GET    /leads/{id}/    — detail
    PATCH  /leads/{id}/    — update
    POST   /leads/{id}/convert/  — convert to customer
    POST   /leads/{id}/status/   — change status
    """

    pagination_class = RepairOSPageNumberPagination
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [require_permission("crm.leads.view")()]
        if self.action in ("create",):
            return [require_permission("crm.leads.create")()]
        if self.action in ("partial_update",):
            return [require_permission("crm.leads.edit")()]
        if self.action == "destroy":
            return [require_permission("crm.leads.delete")()]
        if self.action == "convert":
            return [require_permission("crm.leads.convert")()]
        if self.action == "change_status":
            return [require_permission("crm.leads.edit")()]
        return [require_permission("crm.leads.view")()]

    def get_queryset(self):
        qs = Lead.objects.filter(self._shop_filter()).select_related("assigned_to", "converted_customer")

        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(phone__icontains=search))

        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)

        assigned_to = self.request.query_params.get("assigned_to")
        if assigned_to:
            qs = qs.filter(assigned_to_id=assigned_to)

        shop_id = self.request.query_params.get("shop_id")
        if shop_id:
            qs = qs.filter(shop_id=shop_id)

        date_from = self.request.query_params.get("date_from")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)

        date_to = self.request.query_params.get("date_to")
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        return qs.order_by("-created_at")

    def get_serializer_class(self):
        if self.action == "change_status":
            return LeadStatusSerializer
        return LeadSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data.get("phone", "")
        shop = serializer.validated_data.get("shop")
        if phone and Lead.objects.filter(shop=shop, phone=phone).exists():
            return Response(
                {"code": "DUPLICATE_PHONE", "message": "A lead with this phone number already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="convert")
    def convert(self, request, pk=None):
        lead = self.get_object()
        customer = services.convert_lead(lead, request.user)
        return Response(CustomerSerializer(customer).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="status")
    def change_status(self, request, pk=None):
        lead = self.get_object()
        serializer = LeadStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lead = services.transition_lead(
            lead,
            serializer.validated_data["to_status"],
            request.user,
            serializer.validated_data.get("reason", ""),
        )
        return Response(LeadSerializer(lead).data)

    @action(detail=True, methods=["post"], url_path="quote",
            permission_classes=[require_permission("crm.leads.edit")])
    def send_quote(self, request, pk=None):
        lead = self.get_object()
        serializer = SendQuoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        quote = services.send_quote(lead, serializer.validated_data, request.user)
        return Response(LeadQuoteSerializer(quote).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="quotes")
    def list_quotes(self, request, pk=None):
        lead = self.get_object()
        quotes = lead.quotes.select_related("sent_by").order_by("-created_at")
        return Response(LeadQuoteSerializer(quotes, many=True).data)


# ──────────────────────────────────────────────────────────────────────────────
# Customer viewset
# ──────────────────────────────────────────────────────────────────────────────


class CustomerViewSet(ShopScopedMixin, ModelViewSet):
    """
    GET    /customers/              — list (search name/phone, filter shop/type)
    POST   /customers/              — create
    GET    /customers/{id}/         — detail (360° view)
    PATCH  /customers/{id}/         — update
    POST   /customers/merge/        — merge two customers
    GET    /customers/{id}/timeline/ — communication timeline
    """

    pagination_class = RepairOSPageNumberPagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action in ("list", "retrieve", "timeline"):
            return [require_permission("crm.customers.view")()]
        if self.action == "create":
            return [require_permission("crm.customers.create")()]
        if self.action == "partial_update":
            return [require_permission("crm.customers.edit")()]
        if self.action == "merge":
            return [require_permission("crm.customers.merge")()]
        return [require_permission("crm.customers.view")()]

    def get_queryset(self):
        qs = Customer.objects.filter(self._shop_filter()).select_related("source_lead")

        search = self.request.query_params.get("search") or self.request.query_params.get("q")
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(phone__icontains=search))

        customer_type = self.request.query_params.get("customer_type")
        if customer_type:
            qs = qs.filter(customer_type=customer_type)

        shop_id = self.request.query_params.get("shop_id")
        if shop_id:
            qs = qs.filter(shop_id=shop_id)

        return qs

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data.get("phone", "")
        if phone and Customer.objects.filter(phone=phone).exists():
            return Response(
                {"code": "DUPLICATE_PHONE", "message": "A customer with this phone number already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        self.perform_create(serializer)
        from authentication.models import AuditLog
        services._write_audit(request.user.id, AuditLog.Action.CREATE, "Customer", serializer.instance.id)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data.get("phone", "")
        if phone:
            qs = Customer.objects.filter(phone=phone).exclude(pk=instance.pk)
            if qs.exists():
                return Response(
                    {"code": "DUPLICATE_PHONE", "message": "A customer with this phone number already exists."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        self.perform_update(serializer)
        return Response(serializer.data)

    def get_serializer_class(self):
        if self.action == "merge":
            return CustomerMergeSerializer
        return CustomerSerializer

    @action(detail=False, methods=["post"], url_path="merge")
    def merge(self, request):
        serializer = CustomerMergeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        shop_filter = self._shop_filter()
        try:
            source = Customer.objects.filter(shop_filter).get(pk=serializer.validated_data["source_id"])
            target = Customer.objects.filter(shop_filter).get(pk=serializer.validated_data["target_id"])
        except Customer.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("One or both customers not found.")

        merged = services.merge_customers(source, target, request.user)
        return Response(CustomerSerializer(merged).data)

    @action(detail=True, methods=["get"], url_path="timeline")
    def timeline(self, request, pk=None):
        customer = self.get_object()
        qs = CommunicationLog.objects.filter(customer=customer).select_related("logged_by")

        comm_type = request.query_params.get("type")
        if comm_type:
            qs = qs.filter(type=comm_type)

        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = CommunicationLogSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        return Response(CommunicationLogSerializer(qs, many=True).data)


# ──────────────────────────────────────────────────────────────────────────────
# Communication log viewset
# ──────────────────────────────────────────────────────────────────────────────


class CommunicationLogViewSet(CreateModelMixin, ListModelMixin, GenericViewSet):
    """
    POST  /communications/  — log a communication entry
    GET   /communications/  — list (filter by customer/lead)
    """

    serializer_class = CommunicationLogSerializer
    pagination_class = RepairOSCursorPagination

    def get_permissions(self):
        return [require_permission("crm.communications.log")()]

    def perform_create(self, serializer):
        super().perform_create(serializer)
        from authentication.models import AuditLog
        services._write_audit(self.request.user.id, AuditLog.Action.CREATE, "CommunicationLog", serializer.instance.id)

    def get_queryset(self):
        qs = CommunicationLog.objects.select_related("logged_by", "customer", "lead")
        customer_id = self.request.query_params.get("customer_id")
        if customer_id:
            qs = qs.filter(customer_id=customer_id)
        lead_id = self.request.query_params.get("lead_id")
        if lead_id:
            qs = qs.filter(lead_id=lead_id)
        return qs


# ──────────────────────────────────────────────────────────────────────────────
# Follow-up task viewset
# ──────────────────────────────────────────────────────────────────────────────


class FollowUpTaskViewSet(ShopScopedMixin, ModelViewSet):
    """
    GET    /tasks/          — list (filter status/due/assigned_to)
    POST   /tasks/          — create
    GET    /tasks/{id}/     — detail
    PATCH  /tasks/{id}/     — update
    POST   /tasks/{id}/complete/ — mark completed
    """

    pagination_class = RepairOSPageNumberPagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        return [require_permission("crm.tasks.manage")()]

    def get_queryset(self):
        qs = FollowUpTask.objects.select_related("assigned_to", "customer", "lead")

        task_status = self.request.query_params.get("status")
        if task_status:
            qs = qs.filter(status=task_status)

        assigned_to = self.request.query_params.get("assigned_to")
        if assigned_to:
            qs = qs.filter(assigned_to_id=assigned_to)

        due_from = self.request.query_params.get("due_from")
        if due_from:
            qs = qs.filter(due_date__gte=due_from)

        due_to = self.request.query_params.get("due_to")
        if due_to:
            qs = qs.filter(due_date__lte=due_to)

        return qs

    def get_serializer_class(self):
        if self.action == "complete":
            return TaskCompleteSerializer
        return FollowUpTaskSerializer

    def perform_create(self, serializer):
        super().perform_create(serializer)
        from authentication.models import AuditLog
        services._write_audit(self.request.user.id, AuditLog.Action.CREATE, "FollowUpTask", serializer.instance.id)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        task = self.get_object()
        task = services.complete_task(task, request.user)
        from authentication.models import AuditLog
        services._write_audit(request.user.id, AuditLog.Action.UPDATE, "FollowUpTask", task.id, new_value={"status": "completed"})
        return Response(FollowUpTaskSerializer(task).data)


# ──────────────────────────────────────────────────────────────────────────────
# Customer segment viewset
# ──────────────────────────────────────────────────────────────────────────────


class CustomerSegmentViewSet(ModelViewSet):
    """
    GET    /segments/                       — list
    POST   /segments/                       — create
    GET    /segments/{id}/                  — detail
    PATCH  /segments/{id}/                  — update
    GET    /segments/{id}/members/          — list members (dynamic: evaluated; static: explicit)
    POST   /segments/{id}/bulk-whatsapp/    — queue bulk WhatsApp messages
    """

    serializer_class = CustomerSegmentSerializer
    pagination_class = RepairOSCursorPagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        return [require_permission("crm.segments.manage")()]

    def get_queryset(self):
        return CustomerSegment.objects.all()

    @action(detail=True, methods=["get"], url_path="members")
    def members(self, request, pk=None):
        segment = self.get_object()

        if segment.is_dynamic:
            customers = services.evaluate_segment(segment)
            page = self.paginate_queryset(customers)
            data = CustomerSerializer(page if page is not None else customers, many=True).data
            if page is not None:
                return self.get_paginated_response(data)
            return Response(data)

        # Static segment — return explicit members
        members_qs = (
            CustomerSegmentMember.objects.filter(segment=segment)
            .select_related("customer")
        )
        page = self.paginate_queryset(members_qs)
        data = CustomerSegmentMemberSerializer(
            page if page is not None else members_qs, many=True
        ).data
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)

    @action(detail=True, methods=["get"], url_path="recipient-count")
    def recipient_count(self, request, pk=None):
        """Pre-send preview: how many members will actually receive the message
        once WhatsApp opt-outs are excluded."""
        segment = self.get_object()
        total, ids = services.segment_recipient_ids(segment)
        return Response(
            {"total": total, "recipients": len(ids), "excluded_optout": total - len(ids)}
        )

    @action(detail=True, methods=["post"], url_path="bulk-whatsapp")
    def bulk_whatsapp(self, request, pk=None):
        from .tasks import send_bulk_whatsapp_segment

        segment = self.get_object()
        serializer = BulkWhatsAppSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Opted-in recipients (opt-out excluded) + how many were dropped.
        total, customer_ids = services.segment_recipient_ids(segment)
        excluded_count = total - len(customer_ids)

        send_bulk_whatsapp_segment.delay(
            customer_ids=[str(cid) for cid in customer_ids],
            template_name=serializer.validated_data["template_name"],
            variables=serializer.validated_data["variables"],
        )

        return Response(
            {"queued": len(customer_ids), "excluded_optout": excluded_count},
            status=status.HTTP_202_ACCEPTED,
        )


# ──────────────────────────────────────────────────────────────────────────────
# Campaign viewset  (bulk-WhatsApp history)
# ──────────────────────────────────────────────────────────────────────────────


class CampaignViewSet(ListModelMixin, RetrieveModelMixin, CreateModelMixin, GenericViewSet):
    """
    GET  /campaigns/        — history (newest first)
    GET  /campaigns/{id}/   — detail
    POST /campaigns/        — create + trigger send (manual; no scheduling)
    """

    serializer_class = CampaignSerializer
    pagination_class = RepairOSPageNumberPagination

    def get_permissions(self):
        return [require_permission("crm.segments.manage")()]

    def get_queryset(self):
        return Campaign.objects.select_related("segment", "created_by").order_by("-created_at")

    def create(self, request, *args, **kwargs):
        serializer = CampaignCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            segment = CustomerSegment.objects.get(pk=serializer.validated_data["segment_id"])
        except CustomerSegment.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Segment not found.")

        campaign = services.create_campaign(
            segment=segment,
            name=serializer.validated_data["name"],
            template=serializer.validated_data["template"],
            variables=serializer.validated_data.get("variables", {}),
            user=request.user,
        )
        return Response(CampaignSerializer(campaign).data, status=status.HTTP_201_CREATED)


# ──────────────────────────────────────────────────────────────────────────────
# CRM overview  (read-only dashboard hub)
# ──────────────────────────────────────────────────────────────────────────────


class CrmOverviewView(ShopScopedMixin, APIView):
    """GET /crm/overview/ — KPI counts, lead pipeline, and needs-attention lists."""

    def get_permissions(self):
        return [require_permission("crm.customers.view")()]

    def get(self, request):
        shop_id = request.query_params.get("shop_id")
        data = services.get_crm_overview(self._shop_filter(), shop_id)
        return Response(CrmOverviewSerializer(data).data)
