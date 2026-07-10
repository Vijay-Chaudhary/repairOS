"""
Tenant resolution for token-less refresh requests.

On a hard browser reload the refresh request carries neither an Authorization
header, a tenant subdomain, nor an X-Tenant-Slug header — only the HttpOnly
refresh cookie. Its signed `tenant_slug` claim is then the only tenant hint, so
TenantMiddleware must resolve the tenant from it. Without this, the refresh runs
against the master DB and 500s on the tenant-only `token_blacklist_*` tables
(observed in production as logout-on-refresh).
"""

import pytest
from django.test import RequestFactory
from rest_framework_simplejwt.tokens import RefreshToken

from core.middleware import TenantMiddleware


@pytest.mark.django_db
class TestTenantSlugFromRefreshCookie:
    refresh_url = "/api/v1/auth/token/refresh/"

    def _refresh_cookie(self, user, slug: str) -> str:
        refresh = RefreshToken.for_user(user)
        refresh["tenant_slug"] = slug
        return str(refresh)

    def test_resolves_tenant_from_refresh_cookie(self, tenant_user):
        """No JWT header / subdomain / X-Tenant-Slug — only the refresh cookie."""
        request = RequestFactory().post(self.refresh_url)
        request.COOKIES["refresh_token"] = self._refresh_cookie(tenant_user, "acme")

        mw = TenantMiddleware(lambda r: None)
        assert mw._resolve_slug(request) == "acme"

    def test_no_refresh_cookie_resolves_to_none(self, tenant_user):
        request = RequestFactory().post(self.refresh_url)

        mw = TenantMiddleware(lambda r: None)
        assert mw._resolve_slug(request) is None
