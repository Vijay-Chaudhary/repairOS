"""Finance API views."""

import logging
from decimal import Decimal

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission
from core.pagination import RepairOSCursorPagination

from . import services
from .models import BudgetAllocation, BudgetHead, Expense, PettyCashAccount, PettyCashTransaction, ShopAsset
from .serializers import (
    BudgetAllocationSerializer,
    BudgetHeadSerializer,
    CreateAssetSerializer,
    CreateBudgetAllocationSerializer,
    CreateExpenseSerializer,
    CreatePettyCashTxnSerializer,
    ExpenseSerializer,
    PettyCashAccountSerializer,
    PettyCashTransactionSerializer,
    ShopAssetSerializer,
    UpdateAssetSerializer,
)

logger = logging.getLogger(__name__)


def _shop_ids_from_token(request):
    """Return (shop_ids_list, is_tenant_wide) extracted from the JWT."""
    token = getattr(request, "auth", None) or {}
    is_wide = bool(token.get("is_tenant_wide") or token.get("is_platform_admin"))
    shop_ids = token.get("shop_ids", [])
    return shop_ids, is_wide


class PettyCashAccountView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.petty_cash.manage")]

    def get(self, request: Request, shop_id) -> Response:
        shop_ids, is_wide = _shop_ids_from_token(request)
        if not is_wide and str(shop_id) not in [str(s) for s in shop_ids]:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            account = PettyCashAccount.objects.get(shop_id=shop_id)
        except PettyCashAccount.DoesNotExist:
            return Response({"detail": "No petty cash account for this shop."}, status=status.HTTP_404_NOT_FOUND)
        return Response(PettyCashAccountSerializer(account).data)


class PettyCashTransactionView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.petty_cash.manage")]

    def get(self, request: Request) -> Response:
        """List transactions scoped to the user's shops, with optional filters."""
        shop_ids, is_wide = _shop_ids_from_token(request)
        qs = PettyCashTransaction.objects.select_related("recorded_by")
        if not is_wide:
            qs = qs.filter(account__shop_id__in=shop_ids)

        qp = request.query_params
        if account_id := qp.get("account_id"):
            qs = qs.filter(account_id=account_id)
        if date_from := qp.get("date_from"):
            qs = qs.filter(date__gte=date_from)
        if date_to := qp.get("date_to"):
            qs = qs.filter(date__lte=date_to)

        paginator = RepairOSCursorPagination()
        paginator.ordering = "-date"
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(PettyCashTransactionSerializer(page, many=True).data)

    def post(self, request: Request) -> Response:
        serializer = CreatePettyCashTxnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            account = PettyCashAccount.objects.get(id=data["account_id"])
        except PettyCashAccount.DoesNotExist:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)

        # FE sends "type"; service and model use "txn_type" — remap here at the boundary.
        service_data = {**dict(data), "txn_type": data["type"]}
        txn = services.record_petty_cash_txn(account, service_data, request.user)
        return Response(PettyCashTransactionSerializer(txn).data, status=status.HTTP_201_CREATED)


class BudgetHeadListView(APIView):
    permission_classes = [IsAuthenticated, require_permission("erp.budget.manage")]

    def get(self, request: Request) -> Response:
        shop_ids, is_wide = _shop_ids_from_token(request)
        qs = BudgetHead.objects.select_related("shop")
        if not is_wide:
            qs = qs.filter(shop_id__in=shop_ids)
        if shop_id := request.query_params.get("shop_id"):
            qs = qs.filter(shop_id=shop_id)
        qs = qs.order_by("name")
        paginator = RepairOSCursorPagination()
        paginator.ordering = "name"
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(BudgetHeadSerializer(page, many=True).data)

    def post(self, request: Request) -> Response:
        from core.models import Shop
        shop_id = request.data.get("shop_id")
        if not shop_id:
            return Response({"detail": "shop_id required."}, status=status.HTTP_400_BAD_REQUEST)
        shop_ids, is_wide = _shop_ids_from_token(request)
        if not is_wide and str(shop_id) not in [str(s) for s in shop_ids]:
            return Response({"detail": "Shop not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            shop = Shop.objects.get(id=shop_id)
        except Shop.DoesNotExist:
            return Response({"detail": "Shop not found."}, status=status.HTTP_404_NOT_FOUND)
        head = BudgetHead.objects.create(
            shop=shop,
            name=request.data.get("name", ""),
            category=request.data.get("category", ""),
        )
        return Response(BudgetHeadSerializer(head).data, status=status.HTTP_201_CREATED)


class BudgetAllocationView(APIView):
    permission_classes = [IsAuthenticated, require_permission("erp.budget.manage")]

    def get(self, request: Request) -> Response:
        """List allocations, optionally filtered by shop / month / year."""
        shop_ids, is_wide = _shop_ids_from_token(request)
        qs = BudgetAllocation.objects.select_related("head__shop")
        if not is_wide:
            qs = qs.filter(head__shop_id__in=shop_ids)

        qp = request.query_params
        if shop_id := qp.get("shop_id"):
            qs = qs.filter(head__shop_id=shop_id)
        if month := qp.get("month"):
            qs = qs.filter(month=month)
        if year := qp.get("year"):
            qs = qs.filter(year=year)

        qs = qs.order_by("-year", "-month", "head__name")
        return Response({"items": BudgetAllocationSerializer(qs, many=True).data})

    def post(self, request: Request) -> Response:
        serializer = CreateBudgetAllocationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        shop_ids, is_wide = _shop_ids_from_token(request)
        try:
            if is_wide:
                head = BudgetHead.objects.get(id=data["head_id"])
            else:
                head = BudgetHead.objects.get(id=data["head_id"], shop_id__in=shop_ids)
        except BudgetHead.DoesNotExist:
            return Response({"detail": "Budget head not found."}, status=status.HTTP_404_NOT_FOUND)

        # Upsert: update budgeted_amount for existing allocations; recompute variance.
        alloc, created = BudgetAllocation.objects.update_or_create(
            head=head,
            month=data["month"],
            year=data["year"],
            defaults={"budgeted_amount": data["budgeted_amount"]},
        )
        if not created:
            alloc.variance = alloc.actual_amount - alloc.budgeted_amount
            alloc.save(update_fields=["variance"])

        resp_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(BudgetAllocationSerializer(alloc).data, status=resp_status)


class ExpenseListCreateView(APIView):

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), require_permission("erp.expenses.create")()]
        return [IsAuthenticated(), require_permission("erp.expenses.view")()]

    def get(self, request: Request) -> Response:
        shop_ids, is_wide = _shop_ids_from_token(request)
        qs = Expense.objects.select_related("shop", "budget_head", "recorded_by")
        if not is_wide:
            qs = qs.filter(shop_id__in=shop_ids)

        qp = request.query_params
        if shop_id := qp.get("shop_id"):
            qs = qs.filter(shop_id=shop_id)
        if budget_head_id := qp.get("budget_head_id"):
            qs = qs.filter(budget_head_id=budget_head_id)
        if date_from := qp.get("date_from"):
            qs = qs.filter(date__gte=date_from)
        if date_to := qp.get("date_to"):
            qs = qs.filter(date__lte=date_to)

        qs = qs.order_by("-date")
        paginator = RepairOSCursorPagination()
        paginator.ordering = "-date"
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(ExpenseSerializer(page, many=True).data)

    def post(self, request: Request) -> Response:
        serializer = CreateExpenseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from core.models import Shop
        try:
            shop = Shop.objects.get(id=data["shop_id"])
        except Shop.DoesNotExist:
            return Response({"detail": "Shop not found."}, status=status.HTTP_404_NOT_FOUND)

        expense = services.create_expense(shop, dict(data), request.user)
        return Response(ExpenseSerializer(expense).data, status=status.HTTP_201_CREATED)


class AssetListCreateView(APIView):
    permission_classes = [IsAuthenticated, require_permission("erp.assets.manage")]

    def get(self, request: Request) -> Response:
        shop_ids, is_wide = _shop_ids_from_token(request)
        qs = ShopAsset.objects.select_related("shop", "supplier")
        if not is_wide:
            qs = qs.filter(shop_id__in=shop_ids)

        qp = request.query_params
        if shop_id := qp.get("shop_id"):
            qs = qs.filter(shop_id=shop_id)
        if condition := qp.get("condition"):
            qs = qs.filter(condition=condition)

        is_active_param = qp.get("is_active")
        if is_active_param is None or is_active_param.lower() == "true":
            qs = qs.filter(is_active=True)
        # is_active=false → include all (active + disposed)

        qs = qs.order_by("name")
        paginator = RepairOSCursorPagination()
        paginator.ordering = "name"
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(ShopAssetSerializer(page, many=True).data)

    def post(self, request: Request) -> Response:
        serializer = CreateAssetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from core.models import Shop
        try:
            shop = Shop.objects.get(id=data["shop_id"])
        except Shop.DoesNotExist:
            return Response({"detail": "Shop not found."}, status=status.HTTP_404_NOT_FOUND)

        if ShopAsset.objects.filter(asset_code=data["asset_code"]).exists():
            return Response(
                {"detail": "Asset code already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        asset = ShopAsset.objects.create(
            shop=shop,
            name=data["name"],
            category=data["category"],
            asset_code=data["asset_code"],
            purchase_date=data["purchase_date"],
            purchase_cost=data["purchase_cost"],
            warranty_expiry=data.get("warranty_expiry"),
            condition=data.get("condition", ShopAsset.Condition.GOOD),
            location_description=data.get("location_description", ""),
            notes=data.get("notes", ""),
        )
        return Response(ShopAssetSerializer(asset).data, status=status.HTTP_201_CREATED)


class AssetDetailView(APIView):
    permission_classes = [IsAuthenticated, require_permission("erp.assets.manage")]

    def patch(self, request: Request, asset_id) -> Response:
        serializer = UpdateAssetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        shop_ids, is_wide = _shop_ids_from_token(request)
        qs = ShopAsset.objects.all()
        if not is_wide:
            qs = qs.filter(shop_id__in=shop_ids)
        try:
            asset = qs.get(id=asset_id)
        except ShopAsset.DoesNotExist:
            return Response({"detail": "Asset not found."}, status=status.HTTP_404_NOT_FOUND)

        asset = services.update_asset(asset, serializer.validated_data)
        return Response(ShopAssetSerializer(asset).data)
