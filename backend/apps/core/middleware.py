import logging
from typing import Optional

from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse

from .context import clear_tenant_context, get_tenant_db_alias, set_tenant_db_alias

logger = logging.getLogger(__name__)

# Paths that never require a tenant context (master-only or truly public)
_TENANT_EXEMPT_PREFIXES = ("/api/v1/health/",)


class TenantMiddleware:
    """
    Resolves the tenant on every request and wires the correct DB connection
    into the ORM context before the view runs.

    Resolution order:
      1. JWT claim `tenant_slug` (authenticated requests) — authoritative.
      2. Subdomain `{slug}.API_DOMAIN` (pre-auth login, OTP endpoints).
      3. `X-Tenant-Slug` header (single-domain deployments and local dev).

    The connection alias `tenant_{slug}` is added to `connections.databases`
    once and cached for the process lifetime; credentials are cached in Redis
    for TENANT_CACHE_TTL seconds.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        for prefix in _TENANT_EXEMPT_PREFIXES:
            if request.path.startswith(prefix):
                return self.get_response(request)

        # Track whether context was already set (e.g., by test fixtures).
        # If so, we don't own it and must not clear it on exit.
        context_was_set = bool(get_tenant_db_alias())

        try:
            self._setup_tenant(request)
        except _TenantNotFound as exc:
            return JsonResponse(
                {"success": False, "error": {"code": "NOT_FOUND", "message": str(exc)}},
                status=404,
            )
        except _TenantDBUnavailable as exc:
            return JsonResponse(
                {"success": False, "error": {"code": "TENANT_DB_UNAVAILABLE", "message": str(exc)}},
                status=503,
            )

        try:
            return self.get_response(request)
        finally:
            if not context_was_set:
                clear_tenant_context()

    def _setup_tenant(self, request) -> None:
        # If a tenant context was already set (e.g., test fixtures), don't override it.
        if get_tenant_db_alias():
            return

        slug = self._resolve_slug(request)
        if not slug:
            return  # unauthenticated request with no tenant hint — let view/auth reject

        alias = f"tenant_{slug}"
        db_config = self._load_db_config(slug)
        self._ensure_db_connection(alias, db_config)
        set_tenant_db_alias(alias)

    def _resolve_slug(self, request) -> Optional[str]:
        # 1. JWT claim (authenticated requests)
        slug = self._slug_from_jwt(request)
        if slug:
            return slug

        # 2. Subdomain
        slug = self._slug_from_host(request)
        if slug:
            return slug

        # 3. X-Tenant-Slug header — used by single-domain deployments and local dev.
        # Safe as a last resort: JWT (step 1) already wins for authenticated requests,
        # and credentials are still validated against the resolved tenant DB.
        header = getattr(settings, "TENANT_SLUG_DEV_HEADER", "HTTP_X_TENANT_SLUG")
        slug = request.META.get(header)
        if slug:
            return slug.lower()

        # 4. Refresh-token cookie. A token-less refresh on a hard page reload
        # carries no JWT/subdomain/header — only the HttpOnly refresh cookie,
        # whose signed tenant_slug claim is the sole tenant hint. Without it the
        # refresh runs against the master DB and 500s on the tenant-only
        # token_blacklist_* tables (surfaces as logout-on-refresh).
        slug = self._slug_from_refresh_cookie(request)
        if slug:
            return slug

        return None

    def _slug_from_refresh_cookie(self, request) -> Optional[str]:
        # Cookie name mirrors authentication.views._REFRESH_COOKIE. Decoding via
        # UntypedToken verifies the signature (so the slug is authentic) without
        # touching the blacklist table, which the tenant DB context isn't ready
        # for yet.
        token = request.COOKIES.get("refresh_token")
        if not token:
            return None
        try:
            from rest_framework_simplejwt.tokens import UntypedToken

            slug = UntypedToken(token).payload.get("tenant_slug") or ""
            return slug.lower() or None
        except Exception:
            return None

    def _slug_from_jwt(self, request) -> Optional[str]:
        auth = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth.startswith("Bearer "):
            return None
        token_str = auth[7:]
        try:
            from rest_framework_simplejwt.tokens import UntypedToken

            payload = UntypedToken(token_str).payload
            return payload.get("tenant_slug") or None
        except Exception:
            return None

    def _slug_from_host(self, request) -> Optional[str]:
        host = request.get_host().split(":")[0]  # strip port
        api_domain = getattr(settings, "API_DOMAIN", "api.repaiross.app")
        suffix = f".{api_domain}"
        if host.endswith(suffix):
            subdomain = host[: -len(suffix)]
            if subdomain:
                return subdomain.lower()
        return None

    def _load_db_config(self, slug: str) -> dict:
        cache_key = f"tenant_db_config:{slug}"
        config = cache.get(cache_key)
        if config:
            return config

        from master.models import TenantDatabase

        try:
            tenant_db = (
                TenantDatabase.objects.using("default")
                .select_related("tenant")
                .get(tenant__slug=slug, tenant__status="active", is_active=True)
            )
        except TenantDatabase.DoesNotExist:
            raise _TenantNotFound(f"Tenant '{slug}' not found or is not active.")

        config = {
            "NAME": tenant_db.db_name,
            "HOST": tenant_db.db_host,
            "PORT": str(tenant_db.db_port),
            "USER": tenant_db.db_user,
            "PASSWORD": tenant_db.decrypt_password(),
        }
        cache.set(cache_key, config, timeout=settings.TENANT_CACHE_TTL)
        return config

    @staticmethod
    def _ensure_db_connection(alias: str, config: dict) -> None:
        from django.db import connections

        if alias not in connections.databases:
            connections.databases[alias] = {
                "ENGINE": "django.db.backends.postgresql",
                "CONN_MAX_AGE": settings.TENANT_DB_CONN_MAX_AGE,
                "CONN_HEALTH_CHECKS": False,
                "OPTIONS": {"connect_timeout": 10},
                "TIME_ZONE": None,
                "ATOMIC_REQUESTS": False,
                "AUTOCOMMIT": True,
                "TEST": {},
                **config,
            }


class _TenantNotFound(Exception):
    pass


class _TenantDBUnavailable(Exception):
    pass
