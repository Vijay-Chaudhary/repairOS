"""
Global pytest fixtures.

Sets up:
- A test tenant DB alias pointing at the Django test DB.
- A factory for creating users in that tenant context.
"""

import pytest
from django.test import override_settings


@pytest.fixture(autouse=True)
def tenant_context(db):
    """
    For unit tests, point the tenant context at the default (in-memory) test
    DB so tenant-app models resolve without needing a real per-tenant database.
    """
    from core.context import clear_tenant_context, set_tenant_db_alias

    # Use the test 'default' DB as the tenant DB — router returns this alias
    # for all tenant-app models in tests.
    set_tenant_db_alias("default")
    yield
    clear_tenant_context()


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    return APIClient()


@pytest.fixture
def tenant_user(db):
    from authentication.models import User

    return User.objects.create_user(
        email="test@example.com",
        phone="+919876543210",
        full_name="Test User",
        password="TestPass@123",
    )


@pytest.fixture
def auth_client(api_client, tenant_user):
    """APIClient authenticated as tenant_user via JWT access token."""
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(tenant_user)
    access = refresh.access_token  # access_token property creates a new instance each call
    extra = _build_token_claims(tenant_user, "test")
    for key, value in extra.items():
        access[key] = value

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client
