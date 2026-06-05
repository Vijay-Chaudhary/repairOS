from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Shop


class ShopListView(APIView):
    """
    GET /api/v1/shops/
    Returns shops accessible to the authenticated user.
    Tenant-wide admins get all active shops; shop-scoped users get their assigned shops.
    """
    permission_classes = [IsAuthenticated]

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
