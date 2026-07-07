import re

from django.db import IntegrityError
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission

from .exceptions import DuplicateShopCode, PlanShopLimitExceeded
from .models import Shop
from .serializers import ShopCreateSerializer
from .services import get_tenant_max_shops
from .settings_views import _shop_to_dict


def _derive_shop_code(name: str) -> str:
    """Initials of each word in `name`, capped at 6 chars (e.g. 'Sunrise Repairs - Whitefield' -> 'SRW')."""
    words = [w for w in re.split(r"[^A-Za-z0-9]+", name) if w]
    code = "".join(w[0].upper() for w in words)[:6]
    return code or name[:6].upper()


class ShopListView(APIView):
    """
    GET  /api/v1/shops/  — shops accessible to the authenticated user.
    POST /api/v1/shops/  — create a new shop (Tenant Admin only, plan-limited).
    """

    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("settings.branches.manage")()]
        return [IsAuthenticated()]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        is_tenant_wide = token and (token.get("is_tenant_wide") or token.get("is_platform_admin"))

        if is_tenant_wide:
            shops = Shop.objects.filter(is_active=True).order_by("name")
        else:
            shop_ids = token.get("shop_ids", []) if token else []
            shops = Shop.objects.filter(id__in=shop_ids, is_active=True).order_by("name")

        return Response([
            {"id": str(s.id), "name": s.name, "code": s.code, "address": s.address, "city": s.city}
            for s in shops
        ])

    def post(self, request: Request) -> Response:
        serializer = ShopCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        tenant_slug = (getattr(request, "auth", None) or {}).get("tenant_slug", "")
        max_shops = get_tenant_max_shops(tenant_slug)
        if max_shops is not None and Shop.objects.count() >= max_shops:
            raise PlanShopLimitExceeded(max_shops)

        code = data.get("code") or _derive_shop_code(data["name"])
        if Shop.objects.filter(code=code).exists():
            raise DuplicateShopCode(code)

        try:
            shop = Shop.objects.create(
                name=data["name"],
                code=code,
                address=data["address"],
                city=data["city"],
                state=data["state"],
                state_code=data["state_code"],
                phone=data["phone"],
                is_active=True,
            )
        except IntegrityError:
            raise DuplicateShopCode(code)

        return Response(_shop_to_dict(shop), status=status.HTTP_201_CREATED)
