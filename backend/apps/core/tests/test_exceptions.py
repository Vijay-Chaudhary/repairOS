"""Unit tests for the new shop-related APIException subclasses."""

from rest_framework import status


def test_plan_shop_limit_exceeded_shape():
    from core.exceptions import PlanShopLimitExceeded

    exc = PlanShopLimitExceeded(max_shops=1)
    assert exc.status_code == status.HTTP_403_FORBIDDEN
    assert exc.default_code == "PLAN_SHOP_LIMIT_EXCEEDED"
    assert "1 shop(s)" in str(exc.detail)


def test_duplicate_shop_code_shape():
    from core.exceptions import DuplicateShopCode

    exc = DuplicateShopCode(code="MAIN")
    assert exc.status_code == status.HTTP_409_CONFLICT
    assert exc.default_code == "DUPLICATE_SHOP_CODE"
    assert "MAIN" in str(exc.detail)
