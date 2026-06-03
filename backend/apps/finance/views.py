"""Finance API views."""

import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission

from . import services
from .models import BudgetHead, Expense, PettyCashAccount, ShopAsset
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


class PettyCashAccountView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.petty_cash.manage")]

    def get(self, request: Request, shop_id) -> Response:
        try:
            account = PettyCashAccount.objects.get(shop_id=shop_id)
        except PettyCashAccount.DoesNotExist:
            return Response({"detail": "No petty cash account for this shop."}, status=status.HTTP_404_NOT_FOUND)
        return Response(PettyCashAccountSerializer(account).data)


class PettyCashTransactionView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.petty_cash.manage")]

    def post(self, request: Request) -> Response:
        serializer = CreatePettyCashTxnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            account = PettyCashAccount.objects.get(id=data["account_id"])
        except PettyCashAccount.DoesNotExist:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)

        txn = services.record_petty_cash_txn(account, dict(data), request.user)
        return Response(PettyCashTransactionSerializer(txn).data, status=status.HTTP_201_CREATED)


class BudgetHeadListView(APIView):
    permission_classes = [IsAuthenticated, require_permission("erp.budget.manage")]

    def get(self, request: Request) -> Response:
        heads = BudgetHead.objects.select_related("shop").all()
        return Response(BudgetHeadSerializer(heads, many=True).data)


class BudgetAllocationView(APIView):
    permission_classes = [IsAuthenticated, require_permission("erp.budget.manage")]

    def post(self, request: Request) -> Response:
        serializer = CreateBudgetAllocationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            head = BudgetHead.objects.get(id=data["head_id"])
        except BudgetHead.DoesNotExist:
            return Response({"detail": "Budget head not found."}, status=status.HTTP_404_NOT_FOUND)

        from .models import BudgetAllocation
        if BudgetAllocation.objects.filter(head=head, month=data["month"], year=data["year"]).exists():
            return Response(
                {"detail": "Allocation already exists for this head/month/year."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        alloc = BudgetAllocation.objects.create(
            head=head,
            month=data["month"],
            year=data["year"],
            budgeted_amount=data["budgeted_amount"],
            actual_amount=0,
            variance=0,
        )
        return Response(BudgetAllocationSerializer(alloc).data, status=status.HTTP_201_CREATED)


class ExpenseListCreateView(APIView):

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), require_permission("erp.expenses.create")()]
        return [IsAuthenticated(), require_permission("erp.expenses.view")()]

    def get(self, request: Request) -> Response:
        expenses = Expense.objects.select_related("shop", "budget_head").order_by("-date")
        return Response(ExpenseSerializer(expenses, many=True).data)

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
        assets = ShopAsset.objects.filter(is_active=True).select_related("shop")
        return Response(ShopAssetSerializer(assets, many=True).data)

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

        try:
            asset = ShopAsset.objects.get(id=asset_id)
        except ShopAsset.DoesNotExist:
            return Response({"detail": "Asset not found."}, status=status.HTTP_404_NOT_FOUND)

        asset = services.update_asset(asset, serializer.validated_data)
        return Response(ShopAssetSerializer(asset).data)
