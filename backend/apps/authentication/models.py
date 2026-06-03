import uuid

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager
from django.db import models
from django.utils import timezone

from core.models import BaseModel, SoftDeleteModel


# ──────────────────────────────────────────────────────────────────────────────
# User
# ──────────────────────────────────────────────────────────────────────────────


class UserManager(BaseUserManager):
    def create_user(self, email: str, phone: str, full_name: str, password: str = None, **extra_fields):
        if not email:
            raise ValueError("Email is required.")
        if not phone:
            raise ValueError("Phone is required.")
        email = self.normalize_email(email)
        user = self.model(email=email, phone=phone, full_name=full_name, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, phone: str, full_name: str, password: str = None, **extra_fields):
        extra_fields.setdefault("is_platform_admin", True)
        return self.create_user(email, phone, full_name, password, **extra_fields)


class User(AbstractBaseUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=20, unique=True)
    full_name = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)
    failed_login_attempts = models.IntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    avatar_url = models.CharField(max_length=500, null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.UUIDField(null=True, blank=True)

    # Platform admin flag — set only for master-DB admin users;
    # always False for regular tenant users.
    is_platform_admin = models.BooleanField(default=False)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["phone", "full_name"]

    objects = UserManager()

    class Meta:
        app_label = "authentication"
        db_table = "users"

    def __str__(self) -> str:
        return f"{self.full_name} <{self.email}>"

    @property
    def is_locked(self) -> bool:
        return self.locked_until is not None and timezone.now() < self.locked_until


# ──────────────────────────────────────────────────────────────────────────────
# RBAC
# ──────────────────────────────────────────────────────────────────────────────


class Role(BaseModel):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, default="")
    is_system_role = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = "authentication"
        db_table = "roles"

    def __str__(self) -> str:
        return self.name


class Permission(BaseModel):
    codename = models.CharField(max_length=100, unique=True)
    module = models.CharField(max_length=50)
    label = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")

    class Meta:
        app_label = "authentication"
        db_table = "permissions"

    def __str__(self) -> str:
        return self.codename


class RolePermission(models.Model):
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="role_permissions")
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE, related_name="role_permissions")

    class Meta:
        app_label = "authentication"
        db_table = "role_permissions"
        unique_together = [("role", "permission")]


class UserRole(BaseModel):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="user_roles")
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="user_roles")
    # NULL = tenant-wide role; non-NULL = role scoped to a specific shop
    shop = models.ForeignKey(
        "core.Shop",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="user_roles",
    )

    class Meta:
        app_label = "authentication"
        db_table = "user_roles"
        unique_together = [("user", "role", "shop")]


class UserShopAccess(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="shop_access")
    shop = models.ForeignKey("core.Shop", on_delete=models.CASCADE, related_name="user_access")

    class Meta:
        app_label = "authentication"
        db_table = "user_shop_access"
        unique_together = [("user", "shop")]


# ──────────────────────────────────────────────────────────────────────────────
# Audit
# ──────────────────────────────────────────────────────────────────────────────


class AuditLog(models.Model):
    class Action(models.TextChoices):
        CREATE = "create", "Create"
        UPDATE = "update", "Update"
        DELETE = "delete", "Delete"
        LOGIN = "login", "Login"
        LOGOUT = "logout", "Logout"
        PERMISSION_DENIED = "permission_denied", "Permission Denied"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_id = models.UUIDField(null=True, blank=True, db_index=True)
    action = models.CharField(max_length=20, choices=Action.choices)
    model_name = models.CharField(max_length=100)
    object_id = models.UUIDField(null=True, blank=True)
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        app_label = "authentication"
        db_table = "audit_logs"
        ordering = ["-created_at"]


# ──────────────────────────────────────────────────────────────────────────────
# Token family (refresh-token replay detection)
# ──────────────────────────────────────────────────────────────────────────────


class UserTokenFamily(BaseModel):
    """
    Tracks JWT refresh token families per user for replay detection.

    On refresh:  verify family is not revoked, then rotate.
    On reuse of a revoked/replaced token: revoke entire family (all sessions).
    On logout: revoke the family directly.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="token_families")
    family_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    is_revoked = models.BooleanField(default=False, db_index=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    # jti of the *currently valid* refresh token in this family
    current_jti = models.CharField(max_length=255, unique=True)

    class Meta:
        app_label = "authentication"
        db_table = "user_token_families"

    def revoke(self) -> None:
        self.is_revoked = True
        self.revoked_at = timezone.now()
        self.save(update_fields=["is_revoked", "revoked_at"])
