"""
Audit log read API — list + facets for the /audit viewer page.

The write-path lives in each module's services.py (AuditLog.objects.create);
this file is the read-only surface, gated on settings.audit.view.
"""

from rest_framework import serializers as drf_serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.pagination import RepairOSPageNumberPagination

from .models import AuditLog, User
from .permissions import require_permission


class AuditLogSerializer(drf_serializers.ModelSerializer):
    user_name = drf_serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id", "user_id", "user_name", "action", "model_name", "object_id",
            "old_value", "new_value", "ip_address", "user_agent", "created_at",
        ]

    def get_user_name(self, obj) -> str | None:
        return self.context.get("user_names", {}).get(obj.user_id)


class AuditLogListView(APIView):
    permission_classes = [IsAuthenticated, require_permission("settings.audit.view")]

    def get(self, request: Request) -> Response:
        qs = AuditLog.objects.all()
        qp = request.query_params
        if user_id := qp.get("user_id"):
            qs = qs.filter(user_id=user_id)
        if action := qp.get("action"):
            qs = qs.filter(action=action)
        if model_name := qp.get("model_name"):
            qs = qs.filter(model_name=model_name)
        if date_from := qp.get("date_from"):
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to := qp.get("date_to"):
            qs = qs.filter(created_at__date__lte=date_to)

        paginator = RepairOSPageNumberPagination()
        page = paginator.paginate_queryset(qs, request)
        user_ids = {row.user_id for row in page if row.user_id}
        user_names = dict(
            User.objects.filter(id__in=user_ids).values_list("id", "full_name")
        )
        data = AuditLogSerializer(page, many=True, context={"user_names": user_names}).data
        return paginator.get_paginated_response(data)


class AuditLogFacetsView(APIView):
    permission_classes = [IsAuthenticated, require_permission("settings.audit.view")]

    def get(self, request: Request) -> Response:
        model_names = list(
            AuditLog.objects.exclude(model_name="")
            .order_by("model_name")
            .values_list("model_name", flat=True)
            .distinct()
        )
        user_ids = list(
            AuditLog.objects.filter(user_id__isnull=False)
            .values_list("user_id", flat=True)
            .distinct()
        )
        users = [
            {"id": str(uid), "full_name": name}
            for uid, name in User.objects.filter(id__in=user_ids)
            .order_by("full_name")
            .values_list("id", "full_name")
        ]
        return Response({
            "actions": [choice[0] for choice in AuditLog.Action.choices],
            "model_names": model_names,
            "users": users,
        })
