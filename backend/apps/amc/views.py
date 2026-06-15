"""
AMC views — 5 API endpoints from modules/04-amc §6.

GET/POST  /amc/contracts/               — list / create
PATCH     /amc/contracts/{id}/          — update
GET       /amc/contracts/{id}/visits/   — list visits
POST      /amc/visits/{id}/complete/    — complete a visit
POST      /amc/contracts/{id}/renew/    — manual renewal
"""

import logging

from django.db.models import DateField, OuterRef, Q, Subquery
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from authentication.permissions import require_permission
from core.pagination import RepairOSCursorPagination, RepairOSPageNumberPagination
from crm.views import ShopScopedMixin

from . import services
from .models import AMCContract, AMCVisit
from .serializers import (
    AMCContractListSerializer,
    AMCContractSerializer,
    AMCVisitSerializer,
    CompleteVisitSerializer,
    RenewContractSerializer,
    RescheduleVisitSerializer,
)

logger = logging.getLogger(__name__)


class AMCContractViewSet(ShopScopedMixin, GenericViewSet):
    """
    GET    /amc/contracts/             — list (filter status, customer, shop)
    POST   /amc/contracts/             — create + auto-schedule visits
    GET    /amc/contracts/{id}/        — detail with visits + renewal history
    PATCH  /amc/contracts/{id}/        — update mutable fields
    GET    /amc/contracts/{id}/visits/ — list visits for this contract
    POST   /amc/contracts/{id}/renew/  — manual renewal
    """

    pagination_class = RepairOSPageNumberPagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [require_permission("amc.contracts.view")()]
        if self.action == "create":
            return [require_permission("amc.contracts.create")()]
        if self.action == "partial_update":
            return [require_permission("amc.contracts.edit")()]
        if self.action == "list_visits":
            return [require_permission("amc.visits.schedule")()]
        if self.action == "renew":
            return [require_permission("amc.renewals.manage")()]
        return [require_permission("amc.contracts.view")()]

    def get_queryset(self):
        next_visit_sq = AMCVisit.objects.filter(
            contract_id=OuterRef("pk"),
            status=AMCVisit.Status.SCHEDULED,
            scheduled_date__gte=OuterRef("start_date"),
        ).order_by("scheduled_date").values("scheduled_date")[:1]

        qs = AMCContract.objects.filter(self._shop_filter()).select_related(
            "customer", "shop", "assigned_technician"
        ).annotate(next_visit_date=Subquery(next_visit_sq, output_field=DateField()))

        qp = self.request.query_params
        if s := qp.get("status"):
            qs = qs.filter(status=s)
        if cid := qp.get("customer_id"):
            qs = qs.filter(customer_id=cid)
        if shop_id := qp.get("shop_id"):
            qs = qs.filter(shop_id=shop_id)
        if q := qp.get("search"):
            qs = qs.filter(
                Q(title__icontains=q)
                | Q(customer__name__icontains=q)
                | Q(contract_number__icontains=q)
            )
        return qs

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        page = self.paginate_queryset(qs)
        data = AMCContractListSerializer(page if page is not None else qs, many=True).data
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)

    def create(self, request, *args, **kwargs):
        serializer = AMCContractSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data

        shop = vd.pop("shop")
        customer = vd.pop("customer")
        contract = services.create_contract(shop, customer, vd, request.user)
        return Response(AMCContractSerializer(contract).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        contract = self._get_contract(pk)
        return Response(AMCContractSerializer(contract).data)

    def partial_update(self, request, pk=None):
        contract = self._get_contract(pk)
        serializer = AMCContractSerializer(contract, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data
        # These fields cannot be patched after creation
        for protected in ("contract_number", "shop", "customer", "visit_interval_days"):
            vd.pop(protected, None)
        for attr, value in vd.items():
            setattr(contract, attr, value)
        contract.save()
        return Response(AMCContractSerializer(contract).data)

    @action(detail=True, methods=["get"], url_path="visits")
    def list_visits(self, request, pk=None):
        contract = self._get_contract(pk)
        qs = contract.visits.select_related("technician").order_by("scheduled_date")

        if s := request.query_params.get("status"):
            qs = qs.filter(status=s)

        page = self.paginate_queryset(qs)
        data = AMCVisitSerializer(page if page is not None else qs, many=True).data
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)

    @action(detail=True, methods=["post"], url_path="renew")
    def renew(self, request, pk=None):
        contract = self._get_contract(pk)
        serializer = RenewContractSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        contract = services.renew_contract(
            contract,
            request.user,
            new_end_date=serializer.validated_data.get("new_end_date"),
            new_value=serializer.validated_data.get("new_value"),
        )
        return Response(AMCContractSerializer(contract).data)

    def _get_contract(self, pk):
        """
        Fetch a single contract by PK without applying list-level filters
        (status, customer_id, etc.) that belong to the list endpoint only.
        """
        next_visit_sq = AMCVisit.objects.filter(
            contract_id=OuterRef("pk"),
            status=AMCVisit.Status.SCHEDULED,
            scheduled_date__gte=OuterRef("start_date"),
        ).order_by("scheduled_date").values("scheduled_date")[:1]

        qs = AMCContract.objects.filter(self._shop_filter()).select_related(
            "customer", "shop", "assigned_technician"
        ).annotate(next_visit_date=Subquery(next_visit_sq, output_field=DateField()))

        try:
            return qs.get(pk=pk)
        except AMCContract.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("AMC contract not found.")


class AMCVisitViewSet(GenericViewSet):
    """
    POST /amc/visits/{id}/complete/    — mark a visit as completed
    POST /amc/visits/{id}/reschedule/  — reschedule a visit
    """

    http_method_names = ["post", "head", "options"]

    def get_permissions(self):
        if self.action == "complete":
            return [require_permission("amc.visits.complete")()]
        if self.action == "reschedule":
            return [require_permission("amc.visits.schedule")()]
        return [require_permission("amc.visits.complete")()]

    def get_queryset(self):
        qs = AMCVisit.objects.select_related("contract__shop", "technician")
        token = getattr(self.request, "auth", None)
        if token and not token.get("is_tenant_wide") and not token.get("is_platform_admin"):
            shop_ids = token.get("shop_ids", [])
            qs = qs.filter(contract__shop_id__in=shop_ids)
        return qs

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        visit = self._get_visit(pk)
        serializer = CompleteVisitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        visit = services.complete_visit(visit, serializer.validated_data, request.user)
        return Response(AMCVisitSerializer(visit).data)

    @action(detail=True, methods=["post"], url_path="reschedule")
    def reschedule(self, request, pk=None):
        visit = self._get_visit(pk)
        serializer = RescheduleVisitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        visit = services.reschedule_visit(
            visit, serializer.validated_data["new_date"], request.user
        )
        return Response(AMCVisitSerializer(visit).data)

    def _get_visit(self, pk):
        try:
            return self.get_queryset().get(pk=pk)
        except AMCVisit.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("AMC visit not found.")
