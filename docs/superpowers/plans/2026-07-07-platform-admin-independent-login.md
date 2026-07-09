# Platform Admin — Independent Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give platform admin its own account type, login page, and backend auth stack — fully decoupled from any tenant database.

**Architecture:** A new `PlatformAdminUser` model lives in the master (`default`) DB only, with its own JWT-issuing endpoints (`/api/v1/platform/auth/*`) and its own JWT authentication class (`PlatformAdminJWTAuthentication`) that resolves `request.user` against that model instead of tenant `authentication.User`. The existing `/platform/*` business endpoints (tenants, plans) switch to that authentication class. The frontend gets a parallel `/admin/login` page, API client, and Zustand store, entirely separate from the tenant-scoped ones. The old tenant-DB-based `platform@repaiross.app` row is retired.

**Tech Stack:** Django 4.2 / DRF / `djangorestframework-simplejwt`, PostgreSQL (SQLite in tests), Next.js 14 App Router / TypeScript / Zustand / React Hook Form + Zod, pytest-django, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-07-platform-admin-independent-login-design.md`

**Note on one spec deviation (discovered during planning):** the spec called for a new `PlatformAdminAuditLog` model. While mapping out the master app's existing files, I found `master.models.AuditLogMaster` already exists for exactly this purpose (`event_type`, nullable `tenant`, `actor_email`, JSON `payload`, all on the master DB) and is already used by `master/services.py` for tenant-suspend/reactivate events. This plan reuses `AuditLogMaster` for platform-admin login/logout events instead of adding a duplicate table — same audit-trail guarantee from the spec, no redundant schema.

---

### Task 1: `PlatformAdminUser` + `PlatformAdminTokenFamily` models

**Files:**
- Modify: `backend/apps/master/models.py`
- Test: `backend/apps/master/tests/test_platform_admin_auth.py` (new file)

- [x] **Step 1: Write the failing test**

Create `backend/apps/master/tests/test_platform_admin_auth.py`:

```python
"""
Platform admin independent auth — model, command, and endpoint tests.
See docs/superpowers/specs/2026-07-07-platform-admin-independent-login-design.md.
"""
import pytest


class TestPlatformAdminUserModel:
    def test_set_password_and_check_password(self, db):
        from master.models import PlatformAdminUser

        admin = PlatformAdminUser(email="root@repaiross.app", full_name="Root Admin")
        admin.set_password("StrongPass@123")
        admin.save(using="default")

        admin = PlatformAdminUser.objects.using("default").get(email="root@repaiross.app")
        assert admin.check_password("StrongPass@123")
        assert not admin.check_password("wrong")

    def test_is_locked_false_by_default(self, db):
        from master.models import PlatformAdminUser

        admin = PlatformAdminUser(email="a@repaiross.app", full_name="A")
        admin.set_password("x")
        admin.save(using="default")
        assert admin.is_locked is False

    def test_is_locked_true_when_locked_until_in_future(self, db):
        from django.utils import timezone

        from master.models import PlatformAdminUser

        admin = PlatformAdminUser(
            email="b@repaiross.app", full_name="B",
            locked_until=timezone.now() + timezone.timedelta(minutes=5),
        )
        admin.set_password("x")
        admin.save(using="default")
        assert admin.is_locked is True
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest apps/master/tests/test_platform_admin_auth.py -v`
Expected: FAIL — `ImportError: cannot import name 'PlatformAdminUser' from 'master.models'`

- [x] **Step 3: Add the models**

In `backend/apps/master/models.py`, add near the top imports (`uuid` and `models` are already imported; add):

```python
from django.contrib.auth.models import AbstractBaseUser
from django.utils import timezone
```

Append at the end of the file:

```python
class PlatformAdminUser(AbstractBaseUser):
    """
    Independent platform-admin account — lives only in the master DB, never
    a tenant DB. Not AUTH_USER_MODEL; used solely by the /platform/auth/*
    endpoints and PlatformAdminJWTAuthentication.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)
    failed_login_attempts = models.IntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    USERNAME_FIELD = "email"

    class Meta:
        app_label = "master"
        db_table = "platform_admin_users"

    def __str__(self) -> str:
        return self.email

    @property
    def is_locked(self) -> bool:
        return self.locked_until is not None and timezone.now() < self.locked_until


class PlatformAdminTokenFamily(models.Model):
    """Refresh-token replay detection for platform admins (mirrors authentication.UserTokenFamily)."""

    admin = models.ForeignKey(PlatformAdminUser, on_delete=models.CASCADE, related_name="token_families")
    family_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    is_revoked = models.BooleanField(default=False, db_index=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    current_jti = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "master"
        db_table = "platform_admin_token_families"
```

- [x] **Step 4: Generate the migration**

Run: `cd backend && python manage.py makemigrations master --name platform_admin_auth`
Expected: `Migrations for 'master': apps/master/migrations/0003_platform_admin_auth.py` (or similar auto-generated name), creating `platformadminuser` and `platformadmintokenfamily`.

- [x] **Step 5: Run test to verify it passes**

Run: `cd backend && pytest apps/master/tests/test_platform_admin_auth.py -v`
Expected: 3 passed

- [x] **Step 6: Commit**

```bash
git add backend/apps/master/models.py backend/apps/master/migrations/ backend/apps/master/tests/test_platform_admin_auth.py
git commit -m "feat(master): add PlatformAdminUser + PlatformAdminTokenFamily models"
```

---

### Task 2: `create_platform_admin` management command

**Files:**
- Create: `backend/apps/master/management/commands/create_platform_admin.py`
- Test: `backend/apps/master/tests/test_platform_admin_auth.py`

- [x] **Step 1: Write the failing test**

Append to `test_platform_admin_auth.py`:

```python
from django.core.management import call_command
from django.core.management.base import CommandError


class TestCreatePlatformAdminCommand:
    def test_creates_admin(self, db):
        from master.models import PlatformAdminUser

        call_command(
            "create_platform_admin",
            email="new@repaiross.app", full_name="New Admin", password="Secret@123",
        )
        admin = PlatformAdminUser.objects.using("default").get(email="new@repaiross.app")
        assert admin.check_password("Secret@123")
        assert admin.full_name == "New Admin"

    def test_rejects_duplicate_email(self, db):
        call_command(
            "create_platform_admin",
            email="dup@repaiross.app", full_name="First", password="Secret@123",
        )
        with pytest.raises(CommandError, match="already exists"):
            call_command(
                "create_platform_admin",
                email="dup@repaiross.app", full_name="Second", password="Other@123",
            )
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest apps/master/tests/test_platform_admin_auth.py::TestCreatePlatformAdminCommand -v`
Expected: FAIL — `CommandError: Unknown command: 'create_platform_admin'`

- [x] **Step 3: Write the command**

Create `backend/apps/master/management/commands/create_platform_admin.py`:

```python
"""
Management command to create a platform admin account (master DB only).

Usage:
    python manage.py create_platform_admin --email platform@repaiross.app \
        --full-name "Platform Admin" --password "Demo@1234!"
"""
from django.core.management.base import BaseCommand, CommandError

from master.models import PlatformAdminUser


class Command(BaseCommand):
    help = "Create a platform admin account in the master DB."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--full-name", required=True)
        parser.add_argument("--password", required=True)

    def handle(self, *args, **options):
        email = options["email"].lower()
        full_name = options["full_name"]
        password = options["password"]

        if PlatformAdminUser.objects.using("default").filter(email=email).exists():
            raise CommandError(f"Platform admin '{email}' already exists.")

        admin = PlatformAdminUser(email=email, full_name=full_name)
        admin.set_password(password)
        admin.save(using="default")

        self.stdout.write(self.style.SUCCESS(f"Platform admin '{email}' created."))
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest apps/master/tests/test_platform_admin_auth.py::TestCreatePlatformAdminCommand -v`
Expected: 2 passed

- [x] **Step 5: Commit**

```bash
git add backend/apps/master/management/commands/create_platform_admin.py backend/apps/master/tests/test_platform_admin_auth.py
git commit -m "feat(master): add create_platform_admin management command"
```

---

### Task 3: `PlatformAdminJWTAuthentication`

**Files:**
- Create: `backend/apps/master/tokens.py`
- Test: `backend/apps/master/tests/test_platform_admin_auth.py`

- [x] **Step 1: Write the failing test**

Append to `test_platform_admin_auth.py`:

```python
class TestPlatformAdminJWTAuthentication:
    def test_get_user_resolves_platform_admin_from_token(self, db):
        from rest_framework_simplejwt.tokens import AccessToken

        from master.models import PlatformAdminUser
        from master.tokens import PlatformAdminJWTAuthentication

        admin = PlatformAdminUser(email="tok@repaiross.app", full_name="Tok Admin")
        admin.set_password("x")
        admin.save(using="default")

        # AccessToken.for_user() resolves to the base Token.for_user() (AccessToken
        # doesn't mix in BlacklistMixin), so this is safe to call directly even
        # though `admin` isn't AUTH_USER_MODEL. Do NOT use RefreshToken.for_user()
        # here or anywhere platform-admin tokens are issued — see the note below.
        access = AccessToken.for_user(admin)
        resolved = PlatformAdminJWTAuthentication().get_user(access)
        assert resolved.id == admin.id
        assert resolved.email == "tok@repaiross.app"

    def test_get_user_rejects_unknown_id(self, db):
        import uuid

        from rest_framework_simplejwt.exceptions import AuthenticationFailed
        from rest_framework_simplejwt.tokens import AccessToken

        from master.tokens import PlatformAdminJWTAuthentication

        token = AccessToken()
        token["user_id"] = str(uuid.uuid4())

        with pytest.raises(AuthenticationFailed):
            PlatformAdminJWTAuthentication().get_user(token)
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest apps/master/tests/test_platform_admin_auth.py::TestPlatformAdminJWTAuthentication -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'master.tokens'`

- [x] **Step 3: Write the auth module**

Create `backend/apps/master/tokens.py`:

```python
"""
JWT auth for platform admin — separate from apps/authentication/tokens.py.

Platform-admin access/refresh tokens carry: user_id (the PlatformAdminUser's
id), is_platform_admin, admin_token_type, token_family. They never carry
tenant_slug — that's the whole point.
"""
from typing import Any

from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken
from rest_framework_simplejwt.settings import api_settings


def _build_platform_admin_claims() -> dict[str, Any]:
    # NOTE: the key is "admin_token_type", NOT "token_type" — "token_type" is
    # simplejwt's own reserved claim (TOKEN_TYPE_CLAIM, default "token_type"),
    # used internally by AccessToken/RefreshToken.verify_token_type() to stamp
    # and check "access" vs "refresh". Overwriting it breaks simplejwt's own
    # token-type verification on every decode (raises TokenError: "Token has
    # wrong type"). Found and fixed during Task 5 — see its notes.
    return {
        "is_platform_admin": True,
        "admin_token_type": "platform_admin",
    }


class PlatformAdminJWTAuthentication(JWTAuthentication):
    """
    Resolves request.user against PlatformAdminUser (master DB), not tenant
    authentication.User. Set as authentication_classes on /platform/* views only.
    """

    def get_user(self, validated_token):
        from .models import PlatformAdminUser

        try:
            admin_id = validated_token[api_settings.USER_ID_CLAIM]
        except KeyError as exc:
            raise InvalidToken("Token contained no recognizable user identification") from exc

        try:
            return PlatformAdminUser.objects.using("default").get(id=admin_id, is_active=True)
        except PlatformAdminUser.DoesNotExist as exc:
            raise AuthenticationFailed("Platform admin not found", code="user_not_found") from exc
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest apps/master/tests/test_platform_admin_auth.py::TestPlatformAdminJWTAuthentication -v`
Expected: 2 passed

**Important gotcha for Tasks 4 and 5 (not this task — noted here because this is where it's first relevant):** `RefreshToken.for_user(user)` — used throughout the tenant auth stack in `apps/authentication/views.py` — goes through `BlacklistMixin.for_user()`, which unconditionally creates a `token_blacklist.OutstandingToken` row with `user=<the actual user object>`. That FK is hard-coded to `settings.AUTH_USER_MODEL` (`authentication.User`), so passing a `PlatformAdminUser` instance raises `ValueError: Cannot assign ...: "OutstandingToken.user" must be a "User" instance`. `AccessToken` does **not** mix in `BlacklistMixin`, so `AccessToken.for_user(admin)` is safe (confirmed above) — but wherever Tasks 4/5 need an actual `RefreshToken` for a platform admin, they must NOT call `RefreshToken.for_user(admin)`. Instead construct it manually:

```python
refresh = RefreshToken()
refresh[api_settings.USER_ID_CLAIM] = str(admin.id)
```

This produces an equivalent token (same auto-populated `exp`/`iat`/`jti`/`token_type` claims that a fresh `RefreshToken()` always gets) without ever touching `OutstandingToken`. Calling `.blacklist()` on such a token later (for logout/rotation) is safe and requires no change — `BlacklistMixin.blacklist()` does its own `get_user_model().objects.get(id=...)` lookup against tenant `authentication.User`, catches `DoesNotExist`, and falls back to `user=None` (the FK is nullable), so it never raises for a platform-admin token's jti. Task 4's `_issue_tokens` and Task 5's `PlatformAdminTokenRefreshView` below have already been written with this fix applied.

- [x] **Step 5: Commit**

```bash
git add backend/apps/master/tokens.py backend/apps/master/tests/test_platform_admin_auth.py
git commit -m "feat(master): add PlatformAdminJWTAuthentication"
```

---

### Task 4: Login endpoint

**Files:**
- Modify: `backend/apps/master/serializers.py`
- Create: `backend/apps/master/auth_views.py`
- Modify: `backend/apps/master/urls.py`
- Test: `backend/apps/master/tests/test_platform_admin_auth.py`

- [x] **Step 1: Write the failing test**

Append to `test_platform_admin_auth.py`:

```python
from rest_framework import status
from rest_framework.test import APIClient


@pytest.fixture
def platform_admin(db):
    from master.models import PlatformAdminUser

    admin = PlatformAdminUser(email="admin@repaiross.app", full_name="Root Admin")
    admin.set_password("StrongPass@123")
    admin.save(using="default")
    return admin


@pytest.fixture
def api_client():
    return APIClient()


class TestPlatformAdminLoginView:
    url = "/api/v1/platform/auth/login/"

    def test_success_returns_access_and_sets_cookie(self, api_client, platform_admin):
        res = api_client.post(self.url, {"email": platform_admin.email, "password": "StrongPass@123"})
        assert res.status_code == status.HTTP_200_OK
        assert res.data["access"]
        assert res.data["admin"]["email"] == platform_admin.email
        assert "platform_refresh_token" in res.cookies

    def test_writes_audit_log(self, api_client, platform_admin):
        from master.models import AuditLogMaster

        api_client.post(self.url, {"email": platform_admin.email, "password": "StrongPass@123"})
        assert AuditLogMaster.objects.using("default").filter(
            event_type="platform_admin.login", actor_email=platform_admin.email
        ).exists()

    def test_wrong_password_increments_failed_attempts(self, api_client, platform_admin):
        res = api_client.post(self.url, {"email": platform_admin.email, "password": "wrong"})
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        platform_admin.refresh_from_db()
        assert platform_admin.failed_login_attempts == 1

    def test_locks_after_max_attempts(self, api_client, platform_admin):
        from django.conf import settings

        max_attempts = settings.AUTH_MAX_FAILED_ATTEMPTS
        for _ in range(max_attempts):
            api_client.post(self.url, {"email": platform_admin.email, "password": "wrong"})
        res = api_client.post(self.url, {"email": platform_admin.email, "password": "StrongPass@123"})
        assert res.status_code == status.HTTP_423_LOCKED

    def test_unknown_email_returns_generic_error(self, api_client, db):
        res = api_client.post(self.url, {"email": "nobody@repaiross.app", "password": "whatever"})
        assert res.status_code == status.HTTP_400_BAD_REQUEST
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest apps/master/tests/test_platform_admin_auth.py::TestPlatformAdminLoginView -v`
Expected: FAIL — 404 (no such URL) on every test

- [x] **Step 3: Add the serializer**

Append to `backend/apps/master/serializers.py`:

```python
class PlatformAdminLoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        from django.conf import settings
        from django.utils import timezone

        from core.exceptions import AccountLocked

        from .models import PlatformAdminUser

        # Deliberately generic errors (no "no account found" distinction) — these
        # are superuser accounts, so we don't want to help enumerate valid emails.
        generic_error = serializers.ValidationError({"non_field_errors": ["Invalid credentials."]})

        try:
            admin = PlatformAdminUser.objects.using("default").get(email=attrs["email"].lower())
        except PlatformAdminUser.DoesNotExist:
            raise generic_error

        if admin.is_locked:
            raise AccountLocked(admin.locked_until)

        if not admin.check_password(attrs["password"]):
            admin.failed_login_attempts += 1
            max_attempts = settings.AUTH_MAX_FAILED_ATTEMPTS
            if admin.failed_login_attempts >= max_attempts:
                admin.locked_until = timezone.now() + timezone.timedelta(
                    minutes=settings.AUTH_LOCKOUT_DURATION_MINUTES
                )
                admin.save(using="default", update_fields=["failed_login_attempts", "locked_until"])
                raise AccountLocked(admin.locked_until)
            admin.save(using="default", update_fields=["failed_login_attempts"])
            raise generic_error

        if not admin.is_active:
            raise serializers.ValidationError({"non_field_errors": ["This account has been deactivated."]})

        if admin.failed_login_attempts > 0:
            admin.failed_login_attempts = 0
            admin.locked_until = None
            admin.save(using="default", update_fields=["failed_login_attempts", "locked_until"])

        attrs["admin"] = admin
        return attrs
```

- [x] **Step 4: Add the login view**

Create `backend/apps/master/auth_views.py`:

```python
"""
Platform admin auth endpoints — fully separate from apps/authentication's tenant
auth stack. PlatformAdminUser lives in the master DB and never carries a
tenant_slug claim, so the tenant login/refresh/logout/me views (which resolve
request.user against tenant authentication.User in whatever tenant DB is
routed) cannot be reused here.
"""
import logging
import uuid

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AuditLogMaster, PlatformAdminTokenFamily, PlatformAdminUser
from .serializers import PlatformAdminLoginSerializer
from .tokens import PlatformAdminJWTAuthentication, _build_platform_admin_claims

logger = logging.getLogger(__name__)

_REFRESH_COOKIE = "platform_refresh_token"
_COOKIE_PARAMS = {
    "httponly": True,
    "secure": not getattr(settings, "DEBUG", False),
    "samesite": "Strict",
    "max_age": int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
    "path": "/api/v1/platform/auth/",
}


def _get_ip(request) -> str:
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def _set_refresh_cookie(response: Response, refresh_str: str) -> None:
    response.set_cookie(_REFRESH_COOKIE, refresh_str, **_COOKIE_PARAMS)


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(_REFRESH_COOKIE, path="/api/v1/platform/auth/")


def _write_audit(request, admin_email: str, event_type: str) -> None:
    try:
        AuditLogMaster.objects.using("default").create(
            event_type=event_type,
            actor_email=admin_email,
            payload={
                "ip_address": _get_ip(request),
                "user_agent": request.META.get("HTTP_USER_AGENT", "")[:500],
            },
        )
    except Exception:
        logger.exception("Failed to write platform admin audit log")


def _issue_tokens(admin: PlatformAdminUser) -> tuple[str, str]:
    # Deliberately NOT RefreshToken.for_user(admin) — that goes through
    # BlacklistMixin.for_user(), which creates a token_blacklist.OutstandingToken
    # row with user=admin. That FK is hard-coded to AUTH_USER_MODEL
    # (authentication.User), so it raises ValueError for a PlatformAdminUser.
    # Building the token manually sidesteps OutstandingToken bookkeeping
    # entirely — session lifecycle is tracked via PlatformAdminTokenFamily
    # instead. See the gotcha note in Task 3.
    refresh = RefreshToken()
    refresh[api_settings.USER_ID_CLAIM] = str(admin.id)
    access = refresh.access_token  # property creates a new instance each call — access once
    family_id = uuid.uuid4()

    claims = _build_platform_admin_claims()
    for key, value in claims.items():
        refresh[key] = value
        access[key] = value

    refresh["token_family"] = str(family_id)
    access["token_family"] = str(family_id)

    PlatformAdminTokenFamily.objects.using("default").create(
        admin=admin,
        family_id=family_id,
        current_jti=str(refresh["jti"]),
    )

    return str(access), str(refresh)


class PlatformAdminLoginView(APIView):
    authentication_classes = [PlatformAdminJWTAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PlatformAdminLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        admin = serializer.validated_data["admin"]

        access, refresh = _issue_tokens(admin)
        _write_audit(request, admin.email, "platform_admin.login")

        response = Response(
            {
                "access": access,
                "admin": {
                    "id": str(admin.id),
                    "email": admin.email,
                    "full_name": admin.full_name,
                },
            },
            status=status.HTTP_200_OK,
        )
        _set_refresh_cookie(response, refresh)
        return response
```

- [x] **Step 5: Wire the URL**

In `backend/apps/master/urls.py`, add to the imports section (no change needed, `views` module import stays) and add near the top of `urlpatterns`:

```python
from . import auth_views, views

urlpatterns = [
    path("platform/auth/login/", auth_views.PlatformAdminLoginView.as_view(), name="platform-admin-login"),
    path("register/", views.RegisterView.as_view(), name="register"),
    ...
```

(Replace the existing `from . import views` line with the combined import above, and add the new `path(...)` line as the first entry in `urlpatterns`.)

- [x] **Step 6: Run test to verify it passes**

Run: `cd backend && pytest apps/master/tests/test_platform_admin_auth.py::TestPlatformAdminLoginView -v`
Expected: 5 passed

- [x] **Step 7: Commit**

```bash
git add backend/apps/master/serializers.py backend/apps/master/auth_views.py backend/apps/master/urls.py backend/apps/master/tests/test_platform_admin_auth.py
git commit -m "feat(master): add platform admin login endpoint"
```

---

### Task 5: Refresh + logout + me endpoints

**Files:**
- Modify: `backend/apps/master/auth_views.py`
- Modify: `backend/apps/master/urls.py`
- Test: `backend/apps/master/tests/test_platform_admin_auth.py`

- [x] **Step 1: Write the failing tests**

Append to `test_platform_admin_auth.py`:

```python
class TestPlatformAdminMeAndSessions:
    login_url = "/api/v1/platform/auth/login/"
    refresh_url = "/api/v1/platform/auth/token/refresh/"
    logout_url = "/api/v1/platform/auth/logout/"
    me_url = "/api/v1/platform/auth/me/"

    def _login(self, api_client, platform_admin):
        res = api_client.post(self.login_url, {"email": platform_admin.email, "password": "StrongPass@123"})
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        return res

    def test_me_returns_profile(self, api_client, platform_admin):
        self._login(api_client, platform_admin)
        res = api_client.get(self.me_url)
        assert res.status_code == status.HTTP_200_OK
        assert res.data["email"] == platform_admin.email

    def test_me_rejects_tenant_issued_token(self, api_client, db):
        from authentication.models import User
        from rest_framework_simplejwt.tokens import RefreshToken

        tenant_user = User.objects.create_user(
            email="tenant@example.com", phone="+919876500000",
            full_name="Tenant User", password="whatever",
        )
        access = RefreshToken.for_user(tenant_user).access_token
        access["tenant_slug"] = "demo"
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        res = api_client.get(self.me_url)
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_refresh_rotates_token(self, api_client, platform_admin):
        self._login(api_client, platform_admin)
        res = api_client.post(self.refresh_url, {})
        assert res.status_code == status.HTTP_200_OK
        assert res.data["access"]

    def test_logout_writes_audit_log_and_revokes_family(self, api_client, platform_admin):
        from master.models import AuditLogMaster, PlatformAdminTokenFamily

        self._login(api_client, platform_admin)
        old_cookie = api_client.cookies["platform_refresh_token"].value

        res = api_client.post(self.logout_url, {})
        assert res.status_code == status.HTTP_200_OK
        assert AuditLogMaster.objects.using("default").filter(event_type="platform_admin.logout").exists()

        # Cookie was revoked — presenting it again to refresh must fail.
        api_client.cookies["platform_refresh_token"] = old_cookie
        res = api_client.post(self.refresh_url, {})
        assert res.status_code == status.HTTP_401_UNAUTHORIZED
        assert PlatformAdminTokenFamily.objects.using("default").get().is_revoked
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest apps/master/tests/test_platform_admin_auth.py::TestPlatformAdminMeAndSessions -v`
Expected: FAIL — 404 on refresh/logout/me

- [x] **Step 3: Add the views**

First, add back the imports that Task 4 deliberately omitted from `backend/apps/master/auth_views.py` because they were unused at the time (this task now uses all of them):

```python
from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework_simplejwt.exceptions import TokenError
```

(`AllowAny` is already imported — extend that existing import line to include `IsAuthenticated` rather than adding a second line.) Also add `PlatformAdminJWTAuthentication` back into the existing `from .tokens import _build_platform_admin_claims` line (Task 4 removed it since nothing used it at the time; `PlatformAdminLogoutView` and `PlatformAdminMeView` below need it):

```python
from .tokens import PlatformAdminJWTAuthentication, _build_platform_admin_claims
```

Then append to `backend/apps/master/auth_views.py`:

```python
class PlatformAdminTokenRefreshView(APIView):
    # No authentication class — same reasoning as PlatformAdminLoginView in
    # Task 4: this view never reads request.user (it resolves the admin from
    # the refresh cookie's own claims), and refresh is called precisely when
    # the access token has expired, so requiring a valid Bearer header here
    # would break the normal refresh flow, not just an edge case.
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        from rest_framework.exceptions import NotAuthenticated

        refresh_str = request.COOKIES.get(_REFRESH_COOKIE)
        if not refresh_str:
            raise NotAuthenticated()

        try:
            refresh = RefreshToken(refresh_str)
        except TokenError:
            response = Response(
                {"code": "REFRESH_TOKEN_INVALID", "message": "Refresh token is invalid or expired."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        jti = str(refresh["jti"])
        family_id = refresh.get("token_family")
        admin_id = refresh.get("user_id")

        try:
            family = PlatformAdminTokenFamily.objects.using("default").get(current_jti=jti)
        except PlatformAdminTokenFamily.DoesNotExist:
            if family_id:
                PlatformAdminTokenFamily.objects.using("default").filter(
                    family_id=family_id, is_revoked=False
                ).update(is_revoked=True, revoked_at=timezone.now())
            response = Response(
                {"code": "REFRESH_TOKEN_REUSE", "message": "Token reuse detected. All sessions have been revoked."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        if family.is_revoked:
            response = Response(
                {"code": "REFRESH_TOKEN_REUSE", "message": "Token reuse detected. Please log in again."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        try:
            admin = PlatformAdminUser.objects.using("default").get(id=admin_id, is_active=True)
        except PlatformAdminUser.DoesNotExist:
            response = Response(
                {"code": "NOT_AUTHENTICATED", "message": "Admin not found."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        # Not RefreshToken.for_user(admin) — see the gotcha note in Task 3
        # (BlacklistMixin.for_user() would try to FK an OutstandingToken to a
        # PlatformAdminUser, which isn't AUTH_USER_MODEL, and raise ValueError).
        new_refresh = RefreshToken()
        new_refresh[api_settings.USER_ID_CLAIM] = str(admin.id)
        new_access = new_refresh.access_token
        claims = _build_platform_admin_claims()
        for key, value in claims.items():
            new_refresh[key] = value
            new_access[key] = value
        new_refresh["token_family"] = str(family.family_id)
        new_access["token_family"] = str(family.family_id)

        family.current_jti = str(new_refresh["jti"])
        family.save(using="default", update_fields=["current_jti"])

        try:
            refresh.blacklist()
        except Exception:
            pass

        response = Response({"access": str(new_access)})
        _set_refresh_cookie(response, str(new_refresh))
        return response


class PlatformAdminLogoutView(APIView):
    authentication_classes = [PlatformAdminJWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh_str = request.COOKIES.get(_REFRESH_COOKIE)
        if refresh_str:
            try:
                refresh = RefreshToken(refresh_str)
                jti = str(refresh["jti"])
                PlatformAdminTokenFamily.objects.using("default").filter(current_jti=jti).update(
                    is_revoked=True, revoked_at=timezone.now()
                )
                refresh.blacklist()
            except Exception:
                pass

        _write_audit(request, request.user.email, "platform_admin.logout")

        response = Response({"message": "Logged out successfully."})
        _clear_refresh_cookie(response)
        return response


class PlatformAdminMeView(APIView):
    authentication_classes = [PlatformAdminJWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        admin = request.user
        return Response({
            "id": str(admin.id),
            "email": admin.email,
            "full_name": admin.full_name,
        })
```

- [x] **Step 4: Wire the URLs**

In `backend/apps/master/urls.py`, add below the login path:

```python
    path("platform/auth/token/refresh/", auth_views.PlatformAdminTokenRefreshView.as_view(), name="platform-admin-refresh"),
    path("platform/auth/logout/", auth_views.PlatformAdminLogoutView.as_view(), name="platform-admin-logout"),
    path("platform/auth/me/", auth_views.PlatformAdminMeView.as_view(), name="platform-admin-me"),
```

- [x] **Step 5: Run test to verify it passes**

Run: `cd backend && pytest apps/master/tests/test_platform_admin_auth.py -v`
Expected: all passed (17 tests across the file — 13 from Tasks 1-4 plus these 4 new ones)

- [x] **Step 6: Commit**

```bash
git add backend/apps/master/auth_views.py backend/apps/master/urls.py backend/apps/master/tests/test_platform_admin_auth.py
git commit -m "feat(master): add platform admin refresh/logout/me endpoints"
```

---

### Task 6: Gate `/platform/*` business endpoints on `PlatformAdminJWTAuthentication`

**Files:**
- Modify: `backend/apps/master/views.py`
- Modify: `backend/apps/master/tests/test_platform_admin.py`

This is the cutover point: the existing tenant-management endpoints (tenants list/detail/suspend/reactivate, plans) stop trusting tenant-issued JWTs and start requiring a platform-admin-issued one.

- [x] **Step 1: Update the existing test fixtures first**

In `backend/apps/master/tests/test_platform_admin.py`, replace the `platform_admin_user` and `platform_client` fixtures (currently around lines 35–53):

```python
@pytest.fixture
def platform_admin_user(db):
    from master.models import PlatformAdminUser

    admin = PlatformAdminUser(email="platform@repaiross.app", full_name="Platform Admin")
    admin.set_password("adminpass")
    admin.save(using="default")
    return admin


@pytest.fixture
def platform_client(db, platform_admin_user):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import AccessToken

    # AccessToken.for_user() (not RefreshToken.for_user()) — AccessToken doesn't
    # mix in BlacklistMixin, so it's safe to call directly on a PlatformAdminUser.
    # See the gotcha note in Task 3: RefreshToken.for_user() would try to FK an
    # OutstandingToken to a user that isn't AUTH_USER_MODEL and raise ValueError.
    access = AccessToken.for_user(platform_admin_user)
    access["is_platform_admin"] = True
    access["admin_token_type"] = "platform_admin"  # NOT "token_type" — see Task 3's tokens.py note
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client
```

- [x] **Step 2: Run the existing suite to confirm it now fails at the auth layer**

Run: `cd backend && pytest apps/master/tests/test_platform_admin.py -v -k "platform_client or PlatformAdmin"`
Expected: FAIL — requests using `platform_client` now get 401, because `TenantListView`/etc. still use the default `TenantJWTAuthentication`, which tries to resolve the token's `user_id` against tenant `authentication.User` and won't find a `PlatformAdminUser` there.

- [x] **Step 3: Add a shared base class and switch the 6 views**

In `backend/apps/master/views.py`, add the import and base class, then update each view class to inherit from it instead of `APIView` (dropping their now-redundant `permission_classes` line):

```python
from .tokens import PlatformAdminJWTAuthentication
```

Add this import near the top, alongside the existing `from . import services` etc.

Add right after the `IsPlatformAdmin` class definition:

```python
class PlatformAdminAPIView(APIView):
    """Base for /platform/* business endpoints — requires a valid platform-admin JWT."""

    authentication_classes = [PlatformAdminJWTAuthentication]
    permission_classes = [IsAuthenticated, IsPlatformAdmin]
```

Then change each of these 6 class declarations (removing their `permission_classes = [IsAuthenticated, IsPlatformAdmin]` line, since it's now inherited):

- `class TenantListView(APIView):` → `class TenantListView(PlatformAdminAPIView):`
- `class TenantDetailView(APIView):` → `class TenantDetailView(PlatformAdminAPIView):`
- `class TenantSuspendView(APIView):` → `class TenantSuspendView(PlatformAdminAPIView):`
- `class TenantReactivateView(APIView):` → `class TenantReactivateView(PlatformAdminAPIView):`
- `class SubscriptionPlanListCreateView(APIView):` → `class SubscriptionPlanListCreateView(PlatformAdminAPIView):`
- `class SubscriptionPlanDetailView(APIView):` → `class SubscriptionPlanDetailView(PlatformAdminAPIView):`

- [x] **Step 4: Run the full master test suite**

Run: `cd backend && pytest apps/master/tests/ -v`

Expect 2 failures beyond what Steps 1-3 already fixed:

```
FAILED test_platform_admin.py::TestPlatformAdminTenants::test_non_platform_admin_cannot_list_tenants
    assert 401 == 403
FAILED test_platform_admin.py::TestSubscriptionPlans::test_patch_plan_requires_platform_admin
    assert 401 == 403
```

Both tests build a **tenant-issued** token (`RefreshToken.for_user(regular_user)` where `regular_user` is a real `authentication.User`) with `is_platform_admin` manually set to `False`, then hit a `/platform/*` business endpoint expecting `403 FORBIDDEN`. Under the old design this worked because `TenantJWTAuthentication` could resolve `regular_user`'s id (a real row in tenant `authentication.User`), so authentication succeeded and `IsPlatformAdmin`'s permission check correctly denied with 403 ("authenticated, but not privileged enough").

Under the new design this is no longer the right mental model: `/platform/*` only ever accepts a platform-admin-issued token, full stop. A tenant-issued token's `user_id` doesn't exist in `PlatformAdminUser` (different table, different DB) at all, so `PlatformAdminJWTAuthentication.get_user()` raises `AuthenticationFailed` — the request never gets far enough to reach permission checking. This is **401** ("not authenticated as a platform admin"), not 403 ("authenticated but forbidden") — and that's actually more correct now, not a regression: it's the identical semantics already established by Task 5's `test_me_rejects_tenant_issued_token`, which expects 401 for exactly this scenario against `/platform/auth/me/`.

Update both assertions from `status.HTTP_403_FORBIDDEN` to `status.HTTP_401_UNAUTHORIZED` (one-line change each, at the `assert res.status_code == ...` line in each test). No other change needed — the tests still correctly verify "a non-platform-admin cannot reach this endpoint," just via the more accurate status code.

Re-run: `cd backend && pytest apps/master/tests/ -v`
Expected: all passed, no regressions.

- [x] **Step 5: Commit**

```bash
git add backend/apps/master/views.py backend/apps/master/tests/test_platform_admin.py
git commit -m "feat(master): require PlatformAdminJWTAuthentication on /platform/* business endpoints"
```

---

### Task 7: Retire the tenant-DB platform admin

**Files:**
- Modify: `backend/apps/authentication/seeds.py:86-96`
- Modify: `backend/entrypoint.sh`
- Modify: `infra/docker/seed.sh`

- [x] **Step 1: Remove the platform-admin block from the demo seeder**

In `backend/apps/authentication/seeds.py`, delete lines 86–96 (the `# Seed platform admin user...` block):

```python
        # Seed platform admin user (stored in tenant DB, is_platform_admin=True)
        platform_admin, created = User.objects.get_or_create(
            email="platform@repaiross.app",
            defaults={"phone": "+919999999999", "full_name": "Platform Admin", "is_active": True,
                      "is_platform_admin": True},
        )
        platform_admin.is_platform_admin = True
        platform_admin.set_password(DEMO_PASSWORD)
        platform_admin.failed_login_attempts = 0
        platform_admin.locked_until = None
        platform_admin.save(update_fields=["is_platform_admin", "password", "failed_login_attempts", "locked_until"])

```

(Leave the surrounding `# Ensure role-permission defaults...` block and `ctx["users"] = users` line intact — only the platform-admin block is removed.)

- [x] **Step 2: Add platform admin creation to `backend/entrypoint.sh`**

In `backend/entrypoint.sh`, right after the `"==> [seed] Running master DB migrations..."` step and before `"==> [seed] Migrating all tenant databases..."`, add:

```bash
echo "==> [seed] Creating platform admin (idempotent)..."
python manage.py create_platform_admin \
  --email "platform@repaiross.app" \
  --full-name "Platform Admin" \
  --password "Demo@1234!" \
  2>&1 | grep -v "already exists" || true
```

- [x] **Step 3: Mirror the same change in `infra/docker/seed.sh`**

In `infra/docker/seed.sh`, add the identical block right after `"==> [seed] Running master DB migrations..."` and before `"==> [seed] Seeding demo tenants (idempotent)..."`.

- [x] **Step 4: Verify locally**

Run: `cd backend && python manage.py create_platform_admin --email platform@repaiross.app --full-name "Platform Admin" --password "Demo@1234!"`
Expected: `Platform admin 'platform@repaiross.app' created.` (or `CommandError: ... already exists` if run twice — both are correct idempotent behavior)

- [x] **Step 5: Commit**

```bash
git add backend/apps/authentication/seeds.py backend/entrypoint.sh infra/docker/seed.sh
git commit -m "feat(master): retire tenant-DB platform admin, provision via create_platform_admin"
```

---

### Task 8: `usePlatformAuthStore` (frontend)

**Files:**
- Create: `frontend/src/lib/stores/platformAuthStore.ts`
- Test: `frontend/src/lib/stores/__tests__/platformAuthStore.test.ts`

- [x] **Step 1: Write the failing test**

Create `frontend/src/lib/stores/__tests__/platformAuthStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { usePlatformAuthStore } from '@/lib/stores/platformAuthStore';

describe('usePlatformAuthStore', () => {
  beforeEach(() => {
    usePlatformAuthStore.setState({ accessToken: null, admin: null, isBootstrapping: true });
  });

  it('starts with no admin and no token', () => {
    const state = usePlatformAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.admin).toBeNull();
  });

  it('setAccessToken stores the token', () => {
    usePlatformAuthStore.getState().setAccessToken('abc123');
    expect(usePlatformAuthStore.getState().accessToken).toBe('abc123');
  });

  it('setAdmin stores the admin profile', () => {
    const admin = { id: '1', email: 'platform@repaiross.app', full_name: 'Platform Admin' };
    usePlatformAuthStore.getState().setAdmin(admin);
    expect(usePlatformAuthStore.getState().admin).toEqual(admin);
  });

  it('logout clears token and admin', () => {
    usePlatformAuthStore.getState().setAccessToken('abc123');
    usePlatformAuthStore.getState().setAdmin({ id: '1', email: 'x@x.com', full_name: 'X' });
    usePlatformAuthStore.getState().logout();
    const state = usePlatformAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.admin).toBeNull();
  });

  it('setBootstrapping toggles the flag', () => {
    usePlatformAuthStore.getState().setBootstrapping(false);
    expect(usePlatformAuthStore.getState().isBootstrapping).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/stores/__tests__/platformAuthStore.test.ts`
Expected: FAIL — cannot find module `@/lib/stores/platformAuthStore`

- [x] **Step 3: Write the store**

Create `frontend/src/lib/stores/platformAuthStore.ts`:

```ts
import { create } from 'zustand';

export interface PlatformAdminUser {
  id: string;
  email: string;
  full_name: string;
}

interface PlatformAuthState {
  accessToken: string | null;
  admin: PlatformAdminUser | null;
  isBootstrapping: boolean;

  setAccessToken: (token: string) => void;
  setAdmin: (admin: PlatformAdminUser) => void;
  logout: () => void;
  setBootstrapping: (v: boolean) => void;
}

export const usePlatformAuthStore = create<PlatformAuthState>((set) => ({
  accessToken: null,
  admin: null,
  isBootstrapping: true,

  setAccessToken: (token) => set({ accessToken: token }),
  setAdmin: (admin) => set({ admin }),
  logout: () => set({ accessToken: null, admin: null }),
  setBootstrapping: (v) => set({ isBootstrapping: v }),
}));
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/stores/__tests__/platformAuthStore.test.ts`
Expected: 5 passed

- [x] **Step 5: Commit**

```bash
git add frontend/src/lib/stores/platformAuthStore.ts frontend/src/lib/stores/__tests__/platformAuthStore.test.ts
git commit -m "feat(platform): add usePlatformAuthStore"
```

---

### Task 9: `platformClient.ts` fetch wrapper

**Files:**
- Create: `frontend/src/lib/api/platformClient.ts`

No dedicated test here — this is a direct structural mirror of the already-working `frontend/src/lib/api/client.ts`, and its behavior is exercised end-to-end by Task 10's test and the manual verification in Task 13.

- [x] **Step 1: Write the module**

Create `frontend/src/lib/api/platformClient.ts`:

```ts
import { usePlatformAuthStore } from '@/lib/stores/platformAuthStore';
import { ApiError } from './client';
import type { PageMeta } from './client';

export { ApiError };
export type { PageMeta };

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

type Ok<T> = { success: true; data: T; meta?: PageMeta };
type Err = { success: false; error: { code: string; message: string; fields?: Record<string, string[]> } };
type ApiResponse<T> = Ok<T> | Err;

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/platform/auth/token/refresh/`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const data: ApiResponse<never> = await res.json().catch(() => ({ success: false, error: { code: 'UNKNOWN', message: 'Refresh failed' } }));
      if (!data.success && (data.error.code === 'REFRESH_TOKEN_REUSE' || data.error.code === 'REFRESH_TOKEN_INVALID')) {
        usePlatformAuthStore.getState().logout();
      }
      return null;
    }
    const data: ApiResponse<{ access: string }> = await res.json();
    if (!data.success) return null;
    usePlatformAuthStore.getState().setAccessToken(data.data.access);
    return data.data.access;
  } catch {
    return null;
  }
}

async function silentRefresh(): Promise<string | null> {
  if (isRefreshing) {
    return new Promise((resolve) => refreshQueue.push(resolve));
  }
  isRefreshing = true;
  const token = await doRefresh();
  refreshQueue.forEach((cb) => cb(token));
  refreshQueue = [];
  isRefreshing = false;
  return token;
}

export async function platformApiFetch<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const { skipAuth, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string> | undefined),
  };

  if (!skipAuth) {
    const token = usePlatformAuthStore.getState().accessToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const url = path.startsWith('http') ? path : `${BASE_URL}/api/v1${path}`;

  const makeRequest = async (authHeader?: string): Promise<Response> => {
    if (authHeader) headers['Authorization'] = `Bearer ${authHeader}`;
    return fetch(url, { ...fetchOptions, headers, credentials: 'include' });
  };

  let response = await makeRequest();

  if (response.status === 401 && !skipAuth) {
    const newToken = await silentRefresh();
    if (newToken) {
      response = await makeRequest(newToken);
    } else {
      throw new ApiError('NOT_AUTHENTICATED', 'Session expired', 401);
    }
  }

  const data: ApiResponse<T> = await response.json().catch(() => {
    throw new ApiError('PARSE_ERROR', 'Invalid response from server', response.status);
  });

  if (!data.success) {
    throw new ApiError(data.error.code, data.error.message, response.status, data.error.fields);
  }

  return data.data;
}

export async function platformApiGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = params
    ? `${path}?${new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()}`
    : path;
  return platformApiFetch<T>(url, { method: 'GET' });
}

export async function platformApiPost<T>(path: string, body?: unknown): Promise<T> {
  return platformApiFetch<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function platformApiPatch<T>(path: string, body?: unknown): Promise<T> {
  return platformApiFetch<T>(path, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
```

- [x] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors

- [x] **Step 3: Commit**

```bash
git add frontend/src/lib/api/platformClient.ts
git commit -m "feat(platform): add platformClient fetch wrapper (no X-Tenant-Slug, own refresh endpoint)"
```

---

### Task 10: `platformAuthApi` client

**Files:**
- Create: `frontend/src/lib/api/platformAuth.ts`
- Test: `frontend/src/lib/api/__tests__/platformAuth.test.ts`

- [x] **Step 1: Write the failing test**

Create `frontend/src/lib/api/__tests__/platformAuth.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { platformAuthApi } from '@/lib/api/platformAuth';
import * as platformClientModule from '@/lib/api/platformClient';

vi.mock('@/lib/api/platformClient', () => ({
  platformApiFetch: vi.fn().mockResolvedValue({
    access: 'token',
    admin: { id: '1', email: 'a@a.com', full_name: 'A' },
  }),
  platformApiPost: vi.fn().mockResolvedValue(undefined),
}));

describe('platformAuthApi', () => {
  it('login posts credentials to /platform/auth/login/ without auth', async () => {
    await platformAuthApi.login({ email: 'a@a.com', password: 'pw' });
    expect(platformClientModule.platformApiFetch).toHaveBeenCalledWith(
      '/platform/auth/login/',
      expect.objectContaining({ method: 'POST', skipAuth: true }),
    );
  });

  it('me fetches /platform/auth/me/', async () => {
    await platformAuthApi.me();
    expect(platformClientModule.platformApiFetch).toHaveBeenCalledWith('/platform/auth/me/');
  });

  it('logout posts to /platform/auth/logout/', async () => {
    await platformAuthApi.logout();
    expect(platformClientModule.platformApiPost).toHaveBeenCalledWith('/platform/auth/logout/', {});
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/api/__tests__/platformAuth.test.ts`
Expected: FAIL — cannot find module `@/lib/api/platformAuth`

- [x] **Step 3: Write the client**

Create `frontend/src/lib/api/platformAuth.ts`:

```ts
import { platformApiFetch, platformApiPost } from './platformClient';
import type { PlatformAdminUser } from '@/lib/stores/platformAuthStore';

export interface PlatformLoginResponse {
  access: string;
  admin: PlatformAdminUser;
}

export const platformAuthApi = {
  login: (body: { email: string; password: string }) =>
    platformApiFetch<PlatformLoginResponse>('/platform/auth/login/', {
      method: 'POST',
      body: JSON.stringify(body),
      skipAuth: true,
    }),

  refresh: () =>
    platformApiFetch<{ access: string }>('/platform/auth/token/refresh/', {
      method: 'POST',
      body: JSON.stringify({}),
      skipAuth: true,
    }),

  logout: () => platformApiPost<void>('/platform/auth/logout/', {}),

  me: () => platformApiFetch<PlatformAdminUser>('/platform/auth/me/'),
};
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/api/__tests__/platformAuth.test.ts`
Expected: 3 passed

- [x] **Step 5: Commit**

```bash
git add frontend/src/lib/api/platformAuth.ts frontend/src/lib/api/__tests__/platformAuth.test.ts
git commit -m "feat(platform): add platformAuthApi client"
```

---

### Task 11: Point `platform.ts` (tenants/plans API) at the new client

**Files:**
- Modify: `frontend/src/lib/api/platform.ts:1`

- [x] **Step 1: Change the import**

In `frontend/src/lib/api/platform.ts`, replace line 1:

```ts
import { apiGet, apiPost, apiPatch, type PageMeta } from './client';
```

with:

```ts
import { platformApiGet as apiGet, platformApiPost as apiPost, platformApiPatch as apiPatch, type PageMeta } from './platformClient';
```

Nothing else in the file changes — the aliasing keeps every other line (`apiGet(...)`, `apiPost(...)`, etc.) working as-is, now backed by the platform-admin token/refresh flow instead of the tenant one.

- [x] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors

- [x] **Step 3: Commit**

```bash
git add frontend/src/lib/api/platform.ts
git commit -m "feat(platform): route tenant/plan management calls through platformClient"
```

---

### Task 12: `/admin/login` page

**Files:**
- Create: `frontend/src/app/(platform)/admin/login/page.tsx`

No dedicated component test — matches this codebase's existing convention (the tenant-scoped `(auth)/login/page.tsx` it mirrors has no test either); covered by the manual verification in Task 13.

- [x] **Step 1: Write the page**

Create `frontend/src/app/(platform)/admin/login/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, AlertCircle, ShieldCheck } from 'lucide-react';
import { platformAuthApi } from '@/lib/api/platformAuth';
import { usePlatformAuthStore } from '@/lib/stores/platformAuthStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ApiError } from '@/lib/api/platformClient';

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

export default function PlatformAdminLoginPage() {
  const router = useRouter();
  const { setAccessToken, setAdmin } = usePlatformAuthStore();
  const [apiError, setApiError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: FormValues) {
    setApiError(null);
    setLockedUntil(null);
    try {
      const res = await platformAuthApi.login(values);
      setAccessToken(res.access);
      setAdmin(res.admin);
      router.replace('/platform');
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.code === 'ACCOUNT_LOCKED') {
          setLockedUntil('This account is temporarily locked. Please try again later.');
        } else {
          setApiError('Email or password is incorrect.');
        }
      } else {
        setApiError('Something went wrong. Please try again.');
      }
    }
  }

  const errorMessage = apiError ?? lockedUntil;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-sm mx-auto space-y-7">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <ShieldCheck className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-semibold text-[var(--text)]">RepairOS Platform Admin</span>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-[var(--text)]">Platform admin sign in</h1>
          <p className="text-sm text-[var(--text-muted)]">Independent of any tenant workspace</p>
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2.5 rounded-xl bg-[var(--danger)]/10 border border-[var(--danger)]/25 px-4 py-3 text-sm text-[var(--danger)]">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2} />
            <span>{errorMessage}</span>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-[var(--text)]">Email address</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" placeholder="you@repaiross.app" className="h-11" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-[var(--text)]">Password</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        className="h-11 pr-10"
                        {...field}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                        style={{ minHeight: 0, minWidth: 0 }}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" strokeWidth={2} /> : <Eye className="w-4 h-4" strokeWidth={2} />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full h-11 font-semibold text-sm" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
```

- [x] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors

- [x] **Step 3: Commit**

```bash
git add "frontend/src/app/(platform)/admin/login/page.tsx"
git commit -m "feat(platform): add independent /admin/login page"
```

---

### Task 13: Update `PlatformLayout` to use the platform-admin store/API

**Files:**
- Modify: `frontend/src/app/(platform)/platform/layout.tsx`

- [x] **Step 1: Swap the imports**

In `frontend/src/app/(platform)/platform/layout.tsx`, replace:

```ts
import { useAuthStore } from '@/lib/stores/authStore';
import { authApi } from '@/lib/api/auth';
```

with:

```ts
import { usePlatformAuthStore } from '@/lib/stores/platformAuthStore';
import { platformAuthApi } from '@/lib/api/platformAuth';
```

- [x] **Step 2: Swap the bootstrap logic**

Replace:

```ts
  const { setAccessToken, setUser, logout, isBootstrapping, setBootstrapping, user } = useAuthStore();
```

with:

```ts
  const { setAccessToken, setAdmin, logout, isBootstrapping, setBootstrapping, admin } = usePlatformAuthStore();
```

Replace the bootstrap effect body:

```ts
    (async () => {
      setBootstrapping(true);
      try {
        const res = await authApi.refresh();
        setAccessToken(res.access);
        const me = await authApi.me();
        setUser(me);
        if (!me.is_platform_admin) {
          router.replace('/dashboard');
        }
        wsClient.connect(null, me.id);
      } catch {
        logout();
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      } finally {
        setBootstrapping(false);
      }
    })();
```

with:

```ts
    (async () => {
      setBootstrapping(true);
      try {
        const res = await platformAuthApi.refresh();
        setAccessToken(res.access);
        const me = await platformAuthApi.me();
        setAdmin(me);
        wsClient.connect(null, me.id);
      } catch {
        logout();
        router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
      } finally {
        setBootstrapping(false);
      }
    })();
```

(The `is_platform_admin` redirect-to-`/dashboard` branch is removed — `/platform/auth/me/` only ever succeeds for a platform admin, so the check is no longer meaningful.)

- [x] **Step 3: Swap logout + the render guard**

Replace:

```ts
  async function handleLogout() {
    try { await authApi.logout(); } catch { /* ignore */ }
    logout();
    wsClient.disconnect();
    router.replace('/login');
  }
```

with:

```ts
  async function handleLogout() {
    try { await platformAuthApi.logout(); } catch { /* ignore */ }
    logout();
    wsClient.disconnect();
    router.replace('/admin/login');
  }
```

Replace:

```ts
  if (!user?.is_platform_admin) return null;
```

with:

```ts
  if (!admin) return null;
```

And replace the display of the signed-in user's name:

```ts
          <span className="text-sm text-[var(--text-muted)] hidden sm:block">{user.name}</span>
```

with:

```ts
          <span className="text-sm text-[var(--text-muted)] hidden sm:block">{admin.full_name}</span>
```

- [x] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (confirms no leftover reference to `useAuthStore`/`authApi`/`user` in this file)

- [x] **Step 5: Commit**

```bash
git add "frontend/src/app/(platform)/platform/layout.tsx"
git commit -m "feat(platform): wire PlatformLayout to the independent platform-admin auth stack"
```

---

### Task 14: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the stack**

Run: `docker compose up --build -d` (from repo root)
Expected: backend, frontend, postgres, redis containers healthy; entrypoint logs show `Platform admin 'platform@repaiross.app' created.` (or `already exists` on subsequent runs)

- [ ] **Step 2: Confirm the old path no longer works**

In a browser, go to `http://localhost:3000/login`, enter workspace `demo`, email `platform@repaiross.app`, password `Demo@1234!`.
Expected: login fails (`Email or password is incorrect` or `Workspace not found` depending on whether the row still exists post-seed-change) — this account no longer lives in the `demo` tenant DB.

- [ ] **Step 3: Confirm the new independent login works**

Go to `http://localhost:3000/admin/login`. Note there is no workspace field. Enter email `platform@repaiross.app`, password `Demo@1234!`, submit.
Expected: redirected to `/platform/tenants`, tenant list loads, "Platform Admin" nav badge visible, admin's full name shown top-right.

- [ ] **Step 4: Confirm a tenant user cannot use the admin login**

At `http://localhost:3000/admin/login`, try `admin@demo.com` / `Demo@1234!` (a regular tenant admin).
Expected: rejected with "Email or password is incorrect" (this account doesn't exist in the master DB).

- [ ] **Step 5: Confirm session persistence**

While logged in at `/platform/tenants`, refresh the page.
Expected: stays logged in (silent refresh via the `platform_refresh_token` cookie), tenant list still loads.

- [ ] **Step 6: Confirm logout**

Click "Sign out".
Expected: redirected to `/admin/login`; navigating directly to `/platform/tenants` afterward redirects back to `/admin/login`.

No commit for this task — it's verification of the already-committed work from Tasks 1–13.

---

## Self-Review Notes

- **Spec coverage:** §1 data model → Task 1 (`AuditLogMaster` reused instead of a new model, per the deviation noted at the top). §2 auth flow/tokens → Tasks 3–5. §3 frontend → Tasks 8–13. §4 provisioning/cutover → Tasks 2, 6, 7. §5 out-of-scope items are simply not touched by any task. §6 testing → backend tests embedded in Tasks 1–6, frontend tests in Tasks 8 & 10, manual E2E in Task 14.
- **Placeholder scan:** no TBDs; every step has runnable code or an exact command.
- **Type consistency:** `PlatformAdminUser` (id/email/full_name) shape is identical across the Django model (Task 1), the login/me view responses (Tasks 4–5), the frontend `PlatformAdminUser` interface (Task 8), and `PlatformLoginResponse`/`platformAuthApi` (Tasks 9–10). Cookie name `platform_refresh_token` and path `/api/v1/platform/auth/` are consistent between Task 4 (set) and Task 5 (read/clear). Claim names (`is_platform_admin`, `admin_token_type`, `token_family`) match between `_build_platform_admin_claims` (Task 3) and every place tokens are issued/rotated (Tasks 4–5). (Post-hoc addendum: Task 5 found `admin_token_type` was originally named `token_type`, colliding with simplejwt's reserved `TOKEN_TYPE_CLAIM` and breaking token decode entirely — renamed and documented in Task 3's code; this self-review note reflects the corrected name.)
