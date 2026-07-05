"""Accounts API views — double-entry accounting core."""

import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission
from core.pagination import RepairOSPageNumberPagination

from . import services
from .models import Account, JournalEntry
from .serializers import (
    AccountSerializer,
    CreateAccountSerializer,
    CreateJournalEntrySerializer,
    JournalEntrySerializer,
    LedgerRowSerializer,
    StatementSectionSerializer,
    TrialBalanceRowSerializer,
    UpdateAccountSerializer,
    UpdateJournalEntrySerializer,
)

logger = logging.getLogger(__name__)


def _shop_ids_from_token(request):
    """Return (shop_ids_list, is_tenant_wide) extracted from the JWT."""
    token = getattr(request, "auth", None) or {}
    is_wide = bool(token.get("is_tenant_wide") or token.get("is_platform_admin"))
    shop_ids = token.get("shop_ids", [])
    return shop_ids, is_wide


def _resolve_shop(request, explicit_shop_id=None):
    """Resolve the target Shop for a write, from an explicit id or the token scope.

    Returns (shop, error_response). Exactly one is non-None.
    """
    from core.models import Shop

    shop_ids, is_wide = _shop_ids_from_token(request)
    scope = [str(s) for s in shop_ids]

    if explicit_shop_id:
        if not is_wide and str(explicit_shop_id) not in scope:
            return None, Response({"detail": "Shop not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            return Shop.objects.get(id=explicit_shop_id), None
        except Shop.DoesNotExist:
            return None, Response({"detail": "Shop not found."}, status=status.HTTP_404_NOT_FOUND)

    if len(scope) == 1:
        try:
            return Shop.objects.get(id=scope[0]), None
        except Shop.DoesNotExist:
            return None, Response({"detail": "Shop not found."}, status=status.HTTP_404_NOT_FOUND)

    return None, Response(
        {"detail": "shop_id is required when multiple shops are in scope."},
        status=status.HTTP_400_BAD_REQUEST,
    )


class AccountListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), require_permission("accounts.chart.manage")()]
        return [IsAuthenticated(), require_permission("accounts.ledger.view")()]

    def get(self, request: Request) -> Response:
        shop_ids, is_wide = _shop_ids_from_token(request)
        qs = Account.objects.select_related("shop", "parent")
        if not is_wide:
            qs = qs.filter(shop_id__in=shop_ids)

        qp = request.query_params
        if shop_id := qp.get("shop_id"):
            qs = qs.filter(shop_id=shop_id)
        if account_type := qp.get("account_type"):
            qs = qs.filter(account_type=account_type)
        is_active_param = qp.get("is_active")
        if is_active_param is not None and is_active_param.lower() == "true":
            qs = qs.filter(is_active=True)

        qs = qs.order_by("code")
        paginator = RepairOSPageNumberPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(AccountSerializer(page, many=True).data)

    def post(self, request: Request) -> Response:
        serializer = CreateAccountSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        shop, err = _resolve_shop(request, data.get("shop_id"))
        if err:
            return err

        if Account.objects.filter(shop=shop, code=data["code"]).exists():
            return Response(
                {"detail": "An account with this code already exists for this shop."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        parent = None
        if parent_id := data.get("parent_id"):
            try:
                parent = Account.objects.get(id=parent_id, shop=shop)
            except Account.DoesNotExist:
                return Response({"detail": "Parent account not found."}, status=status.HTTP_400_BAD_REQUEST)

        account = Account.objects.create(
            shop=shop,
            code=data["code"],
            name=data["name"],
            account_type=data["account_type"],
            parent=parent,
        )
        return Response(AccountSerializer(account).data, status=status.HTTP_201_CREATED)


class AccountDetailView(APIView):
    def get_permissions(self):
        if self.request.method in ("PATCH", "DELETE"):
            return [IsAuthenticated(), require_permission("accounts.chart.manage")()]
        return [IsAuthenticated(), require_permission("accounts.ledger.view")()]

    def _get_object(self, request, account_id):
        shop_ids, is_wide = _shop_ids_from_token(request)
        qs = Account.objects.select_related("shop", "parent")
        if not is_wide:
            qs = qs.filter(shop_id__in=shop_ids)
        return qs.filter(id=account_id).first()

    def get(self, request: Request, account_id) -> Response:
        account = self._get_object(request, account_id)
        if account is None:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(AccountSerializer(account).data)

    def patch(self, request: Request, account_id) -> Response:
        account = self._get_object(request, account_id)
        if account is None:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = UpdateAccountSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if "parent_id" in data:
            parent_id = data["parent_id"]
            if parent_id is None:
                account.parent = None
            elif str(parent_id) == str(account.id):
                return Response({"detail": "An account cannot be its own parent."}, status=status.HTTP_400_BAD_REQUEST)
            else:
                parent = Account.objects.filter(id=parent_id, shop=account.shop).first()
                if parent is None:
                    return Response({"detail": "Parent account not found."}, status=status.HTTP_400_BAD_REQUEST)
                account.parent = parent
        if "name" in data:
            account.name = data["name"]
        if "is_active" in data:
            account.is_active = data["is_active"]
        account.save()
        return Response(AccountSerializer(account).data)

    def delete(self, request: Request, account_id) -> Response:
        from core.exceptions import BusinessRuleViolation

        account = self._get_object(request, account_id)
        if account is None:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)

        if account.is_system:
            raise BusinessRuleViolation("System accounts cannot be deleted.")
        if account.journal_lines.filter(entry__status=JournalEntry.Status.POSTED).exists():
            raise BusinessRuleViolation("Accounts with posted journal lines cannot be deleted.")

        account.is_active = False
        account.save(update_fields=["is_active", "updated_at"])
        return Response(AccountSerializer(account).data, status=status.HTTP_200_OK)


class SeedChartView(APIView):
    permission_classes = [IsAuthenticated, require_permission("accounts.chart.manage")]

    def post(self, request: Request) -> Response:
        shop, err = _resolve_shop(request, request.data.get("shop_id"))
        if err:
            return err
        created = services.seed_default_chart(shop)
        return Response(
            {"created": created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


def _journal_queryset(request):
    shop_ids, is_wide = _shop_ids_from_token(request)
    qs = JournalEntry.objects.select_related("shop").prefetch_related("lines__account")
    if not is_wide:
        qs = qs.filter(shop_id__in=shop_ids)
    return qs


class JournalListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), require_permission("accounts.journal.create")()]
        return [IsAuthenticated(), require_permission("accounts.journal.view")()]

    def get(self, request: Request) -> Response:
        qs = _journal_queryset(request)
        qp = request.query_params
        if shop_id := qp.get("shop_id"):
            qs = qs.filter(shop_id=shop_id)
        if status_filter := qp.get("status"):
            qs = qs.filter(status=status_filter)
        if date_from := qp.get("date_from"):
            qs = qs.filter(date__gte=date_from)
        if date_to := qp.get("date_to"):
            qs = qs.filter(date__lte=date_to)

        qs = qs.order_by("-date", "-entry_number")
        paginator = RepairOSPageNumberPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(JournalEntrySerializer(page, many=True).data)

    def post(self, request: Request) -> Response:
        serializer = CreateJournalEntrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        shop, err = _resolve_shop(request, data.get("shop_id"))
        if err:
            return err

        entry = services.create_journal_entry(shop, data)
        return Response(JournalEntrySerializer(entry).data, status=status.HTTP_201_CREATED)


class JournalDetailView(APIView):
    def get_permissions(self):
        if self.request.method in ("PATCH", "DELETE"):
            return [IsAuthenticated(), require_permission("accounts.journal.create")()]
        return [IsAuthenticated(), require_permission("accounts.journal.view")()]

    def _get_object(self, request, entry_id):
        return _journal_queryset(request).filter(id=entry_id).first()

    def get(self, request: Request, entry_id) -> Response:
        entry = self._get_object(request, entry_id)
        if entry is None:
            return Response({"detail": "Journal entry not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(JournalEntrySerializer(entry).data)

    def patch(self, request: Request, entry_id) -> Response:
        from core.exceptions import BusinessRuleViolation

        entry = self._get_object(request, entry_id)
        if entry is None:
            return Response({"detail": "Journal entry not found."}, status=status.HTTP_404_NOT_FOUND)
        if entry.is_posted:
            raise BusinessRuleViolation("Posted entries are immutable.")

        serializer = UpdateJournalEntrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(entry, field, value)
        entry.save()
        return Response(JournalEntrySerializer(entry).data)

    def delete(self, request: Request, entry_id) -> Response:
        from core.exceptions import BusinessRuleViolation

        entry = self._get_object(request, entry_id)
        if entry is None:
            return Response({"detail": "Journal entry not found."}, status=status.HTTP_404_NOT_FOUND)
        if entry.is_posted:
            raise BusinessRuleViolation("Posted entries cannot be deleted.")
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PostJournalView(APIView):
    permission_classes = [IsAuthenticated, require_permission("accounts.journal.post")]

    def post(self, request: Request, entry_id) -> Response:
        entry = _journal_queryset(request).filter(id=entry_id).first()
        if entry is None:
            return Response({"detail": "Journal entry not found."}, status=status.HTTP_404_NOT_FOUND)
        entry = services.post_journal_entry(entry, request.user)
        return Response(JournalEntrySerializer(entry).data, status=status.HTTP_200_OK)


def _parse_date(value):
    from datetime import date as _date
    if not value:
        return None
    try:
        return _date.fromisoformat(value)
    except ValueError:
        return None


class LedgerView(APIView):
    def get_permissions(self):
        return [IsAuthenticated(), require_permission("accounts.ledger.view")()]

    def get(self, request: Request, account_id) -> Response:
        shop_ids, is_wide = _shop_ids_from_token(request)
        qs = Account.objects.select_related("shop")
        if not is_wide:
            qs = qs.filter(shop_id__in=shop_ids)
        account = qs.filter(id=account_id).first()
        if account is None:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)

        date_from = _parse_date(request.query_params.get("date_from"))
        date_to = _parse_date(request.query_params.get("date_to"))
        ledger = services.account_ledger(account, date_from, date_to)

        payload = {
            "account": AccountSerializer(account).data,
            "opening_balance": ledger["opening_balance"],
            "closing_balance": ledger["closing_balance"],
            "rows": LedgerRowSerializer(ledger["rows"], many=True).data,
        }

        if request.query_params.get("format") == "csv":
            from authentication.permissions import HasPermission
            if not HasPermission("accounts.ledger.export").has_permission(request, self):
                return Response(
                    {"detail": "You do not have permission to export."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            return _ledger_csv_response(account, payload)

        return Response(payload)


def _ledger_csv_response(account, payload):
    import csv
    import io

    from django.http import HttpResponse

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Date", "Entry", "Narration", "Debit", "Credit", "Running Balance"])
    for row in payload["rows"]:
        writer.writerow([
            row["date"], row["entry_number"], row["narration"],
            row["debit"], row["credit"], row["running_balance"],
        ])
    resp = HttpResponse(buffer.getvalue(), content_type="text/csv")
    resp["Content-Disposition"] = f'attachment; filename="ledger_{account.code}.csv"'
    return resp


def _require_export_or_403(request, view):
    """Return a 403 when the caller lacks the reports-export permission, else None.

    Plain JsonResponse (not DRF Response): with ?format=csv in the URL, DRF content
    negotiation would 404 a DRF Response because no csv renderer is registered.
    """
    from django.http import JsonResponse

    from authentication.permissions import HasPermission

    if not HasPermission("accounts.reports.export").has_permission(request, view):
        return JsonResponse(
            {"detail": "You do not have permission to export."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


def _statement_csv_response(filename, sections, footer_rows):
    """CSV attachment with one block per (title, section) plus footer total rows."""
    import csv
    import io

    from django.http import HttpResponse

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    for title, section in sections:
        writer.writerow([title])
        writer.writerow(["Code", "Account", "Amount"])
        for row in section["rows"]:
            writer.writerow([row["code"] or "", row["name"], row["amount"]])
        writer.writerow(["", "Subtotal", section["subtotal"]])
        writer.writerow([])
    for label, value in footer_rows:
        writer.writerow(["", label, value])
    resp = HttpResponse(buffer.getvalue(), content_type="text/csv")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


class ProfitLossView(APIView):
    permission_classes = [IsAuthenticated, require_permission("accounts.reports.view")]

    def get(self, request: Request) -> Response:
        shop, err = _resolve_shop(request, request.query_params.get("shop_id"))
        if err:
            return err
        date_from = _parse_date(request.query_params.get("date_from"))
        date_to = _parse_date(request.query_params.get("date_to"))
        result = services.profit_and_loss(shop, date_from, date_to)

        if request.query_params.get("format") == "csv":
            if forbidden := _require_export_or_403(request, self):
                return forbidden
            return _statement_csv_response(
                "profit_and_loss.csv",
                [("Income", result["income"]), ("Expenses", result["expense"])],
                [("Net Profit", result["net_profit"])],
            )

        return Response({
            "income": StatementSectionSerializer(result["income"]).data,
            "expense": StatementSectionSerializer(result["expense"]).data,
            "net_profit": result["net_profit"],
            "date_from": result["date_from"],
            "date_to": result["date_to"],
        })


class BalanceSheetView(APIView):
    permission_classes = [IsAuthenticated, require_permission("accounts.reports.view")]

    def get(self, request: Request) -> Response:
        shop, err = _resolve_shop(request, request.query_params.get("shop_id"))
        if err:
            return err
        as_of = _parse_date(request.query_params.get("as_of"))
        result = services.balance_sheet(shop, as_of)

        if request.query_params.get("format") == "csv":
            if forbidden := _require_export_or_403(request, self):
                return forbidden
            return _statement_csv_response(
                "balance_sheet.csv",
                [
                    ("Assets", result["assets"]),
                    ("Liabilities", result["liabilities"]),
                    ("Equity", result["equity"]),
                ],
                [
                    ("Total Assets", result["total_assets"]),
                    ("Total Liabilities", result["total_liabilities"]),
                    ("Total Equity", result["total_equity"]),
                    ("Balanced", "yes" if result["is_balanced"] else "no"),
                ],
            )

        return Response({
            "assets": StatementSectionSerializer(result["assets"]).data,
            "liabilities": StatementSectionSerializer(result["liabilities"]).data,
            "equity": StatementSectionSerializer(result["equity"]).data,
            "total_assets": result["total_assets"],
            "total_liabilities": result["total_liabilities"],
            "total_equity": result["total_equity"],
            "is_balanced": result["is_balanced"],
            "as_of": result["as_of"],
        })


class TrialBalanceView(APIView):
    permission_classes = [IsAuthenticated, require_permission("accounts.ledger.view")]

    def get(self, request: Request) -> Response:
        shop, err = _resolve_shop(request, request.query_params.get("shop_id"))
        if err:
            return err
        as_of = _parse_date(request.query_params.get("as_of"))
        result = services.trial_balance(shop, as_of)
        return Response({
            "rows": TrialBalanceRowSerializer(result["rows"], many=True).data,
            "total_debit": result["total_debit"],
            "total_credit": result["total_credit"],
        })
