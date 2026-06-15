"""
Settings API views for tenant user/role/permission management.

GET  /users/             — list users (search, is_active filter, cursor pagination)
POST /users/             — invite (create) a user with optional role assignments
PATCH /users/{id}/       — update full_name, is_active, role_ids
POST  /users/{id}/force-logout/ — revoke all refresh token families

GET  /roles/             — list non-deleted roles
POST /roles/             — create role with permission_ids
PATCH /roles/{id}/       — update name / description / permission_ids
DELETE /roles/{id}/      — soft-delete non-system role

GET  /permissions/       — list all permission records
"""

import logging

from django.contrib.auth.hashers import make_password
from django.utils import timezone
from rest_framework import serializers as drf_serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission
from core.pagination import RepairOSCursorPagination, RepairOSPageNumberPagination

from .models import Permission, Role, RolePermission, User, UserRole, UserTokenFamily

logger = logging.getLogger(__name__)


# ── Serializers ───────────────────────────────────────────────────────────────

class TenantUserSerializer(drf_serializers.ModelSerializer):
    role_names = drf_serializers.SerializerMethodField()
    role_ids   = drf_serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "full_name", "email", "phone", "is_active", "avatar_url",
                  "role_names", "role_ids", "last_login", "created_at"]
        read_only_fields = fields

    def get_role_names(self, obj):
        return list(
            Role.objects.filter(user_roles__user=obj, deleted_at__isnull=True)
            .values_list("name", flat=True)
            .distinct()
        )

    def get_role_ids(self, obj):
        return [
            str(r)
            for r in Role.objects.filter(user_roles__user=obj, deleted_at__isnull=True)
            .values_list("id", flat=True)
            .distinct()
        ]


class RoleSerializer(drf_serializers.ModelSerializer):
    permission_ids       = drf_serializers.SerializerMethodField()
    permission_codenames = drf_serializers.SerializerMethodField()
    user_count           = drf_serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = ["id", "name", "description", "is_system_role",
                  "permission_ids", "permission_codenames", "user_count"]
        read_only_fields = fields

    def get_permission_ids(self, obj):
        return [str(p) for p in obj.role_permissions.values_list("permission_id", flat=True)]

    def get_permission_codenames(self, obj):
        return list(
            Permission.objects.filter(role_permissions__role=obj)
            .values_list("codename", flat=True)
        )

    def get_user_count(self, obj):
        return UserRole.objects.filter(role=obj).values("user_id").distinct().count()


class PermissionSerializer(drf_serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["id", "codename", "module", "label", "description"]
        read_only_fields = fields


# ── User views ────────────────────────────────────────────────────────────────

class UserListCreateView(APIView):
    pagination_class = RepairOSPageNumberPagination

    def get_permissions(self):
        return [require_permission("settings.users.manage")()]

    def get(self, request):
        qs = User.objects.filter(is_active__in=[True, False], deleted_at__isnull=True).order_by("-created_at")

        if q := request.query_params.get("search"):
            from django.db.models import Q
            qs = qs.filter(Q(full_name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q))

        is_active_param = request.query_params.get("is_active")
        if is_active_param is not None:
            qs = qs.filter(is_active=is_active_param.lower() in ("true", "1", "yes"))

        if role := request.query_params.get("role"):
            qs = qs.filter(
                user_roles__role__name__iexact=role,
                user_roles__role__deleted_at__isnull=True,
            ).distinct()

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(qs, request)
        data = TenantUserSerializer(page if page is not None else qs, many=True).data
        if page is not None:
            return paginator.get_paginated_response(data)
        return Response({"items": data, "meta": {}})

    def post(self, request):
        data = request.data
        email    = data.get("email", "").strip().lower()
        phone    = data.get("phone", "").strip()
        full_name= data.get("full_name", "").strip()
        role_ids = data.get("role_ids", [])

        if not email or not phone or not full_name:
            raise ValidationError({"detail": "email, phone, and full_name are required."})

        if User.objects.filter(email=email).exists():
            raise ValidationError({"email": "A user with this email already exists."})
        if User.objects.filter(phone=phone).exists():
            raise ValidationError({"phone": "A user with this phone already exists."})

        import secrets as _secrets
        temp_password = _secrets.token_urlsafe(16)

        user = User.objects.create(
            email=email,
            phone=phone,
            full_name=full_name,
            password=make_password(temp_password),
            is_active=True,
        )

        if role_ids:
            roles = Role.objects.filter(id__in=role_ids, deleted_at__isnull=True)
            for role in roles:
                UserRole.objects.get_or_create(user=user, role=role, shop=None)

        logger.info("User invited: %s by %s", user.email, getattr(request.user, "email", "?"))
        return Response(TenantUserSerializer(user).data, status=status.HTTP_201_CREATED)


def _get_user_or_404(user_id):
    try:
        return User.objects.get(id=user_id, deleted_at__isnull=True)
    except User.DoesNotExist:
        raise NotFound("User not found.")


class UserDetailView(APIView):
    def get_permissions(self):
        return [require_permission("settings.users.manage")()]

    def patch(self, request, user_id):
        user = _get_user_or_404(user_id)
        data = request.data

        if "full_name" in data:
            user.full_name = data["full_name"]
        if "is_active" in data:
            user.is_active = bool(data["is_active"])

        user.save(update_fields=["full_name", "is_active"])

        if "role_ids" in data:
            new_role_ids = set(str(r) for r in data["role_ids"])
            current_roles = set(
                str(r) for r in UserRole.objects.filter(user=user, role__deleted_at__isnull=True)
                .values_list("role_id", flat=True)
            )
            to_add = new_role_ids - current_roles
            to_remove = current_roles - new_role_ids
            if to_add:
                roles = Role.objects.filter(id__in=to_add, deleted_at__isnull=True)
                for role in roles:
                    UserRole.objects.get_or_create(user=user, role=role, shop=None)
            if to_remove:
                UserRole.objects.filter(user=user, role_id__in=to_remove).delete()

        return Response(TenantUserSerializer(user).data)


class ForceLogoutView(APIView):
    def get_permissions(self):
        return [require_permission("settings.users.manage")()]

    def post(self, request, user_id):
        user = _get_user_or_404(user_id)
        revoked = UserTokenFamily.objects.filter(user=user, is_revoked=False).update(
            is_revoked=True,
            revoked_at=timezone.now(),
        )
        logger.info("Force-logout: %s revoked %d families", user.email, revoked)
        return Response({"revoked_families": revoked})


# ── Role views ────────────────────────────────────────────────────────────────

class RoleListCreateView(APIView):
    def get_permissions(self):
        return [require_permission("settings.roles.manage")()]

    def get(self, request):
        roles = Role.objects.filter(deleted_at__isnull=True).order_by("name").prefetch_related(
            "role_permissions__permission",
        )
        return Response({"items": RoleSerializer(roles, many=True).data})

    def post(self, request):
        data = request.data
        name = data.get("name", "").strip()
        if not name:
            raise ValidationError({"name": "Role name is required."})
        if Role.objects.filter(name=name, deleted_at__isnull=True).exists():
            raise ValidationError({"name": "A role with this name already exists."})

        description = data.get("description", "")
        permission_ids = data.get("permission_ids", [])

        role = Role.objects.create(name=name, description=description or "")
        if permission_ids:
            perms = Permission.objects.filter(id__in=permission_ids)
            RolePermission.objects.bulk_create(
                [RolePermission(role=role, permission=p) for p in perms],
                ignore_conflicts=True,
            )

        return Response(
            RoleSerializer(role).data,
            status=status.HTTP_201_CREATED,
        )


class RoleDetailView(APIView):
    def get_permissions(self):
        return [require_permission("settings.roles.manage")()]

    def _get_role(self, role_id):
        try:
            return Role.objects.prefetch_related("role_permissions__permission").get(
                id=role_id, deleted_at__isnull=True
            )
        except Role.DoesNotExist:
            raise NotFound("Role not found.")

    def patch(self, request, role_id):
        role = self._get_role(role_id)
        if role.is_system_role:
            raise PermissionDenied("System roles cannot be modified.")

        data = request.data
        if "name" in data:
            role.name = data["name"]
        if "description" in data:
            role.description = data["description"]
        role.save(update_fields=["name", "description"])

        if "permission_ids" in data:
            new_perm_ids = set(str(p) for p in data["permission_ids"])
            RolePermission.objects.filter(role=role).delete()
            if new_perm_ids:
                perms = Permission.objects.filter(id__in=new_perm_ids)
                RolePermission.objects.bulk_create(
                    [RolePermission(role=role, permission=p) for p in perms],
                    ignore_conflicts=True,
                )

        return Response(RoleSerializer(role).data)

    def delete(self, request, role_id):
        role = self._get_role(role_id)
        if role.is_system_role:
            raise PermissionDenied("System roles cannot be deleted.")

        if UserRole.objects.filter(role=role).exists():
            raise ValidationError(
                {"detail": "Cannot delete a role that is assigned to users. Reassign users first."}
            )

        role.deleted_at = timezone.now()
        role.save(update_fields=["deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── Permission view ───────────────────────────────────────────────────────────

class PermissionListView(APIView):
    def get_permissions(self):
        return [require_permission("settings.roles.manage")()]

    def get(self, request):
        perms = Permission.objects.all().order_by("module", "codename")
        return Response({"items": PermissionSerializer(perms, many=True).data})
