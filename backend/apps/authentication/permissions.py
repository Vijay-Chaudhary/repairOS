"""
DRF permission classes for the RepairOS permission catalogue.

Usage:
    class MyView(APIView):
        permission_classes = [HasPermission("repair.jobs.create")]

The permission codenames live in the JWT `permissions` claim, set at login time.
"""

from rest_framework.permissions import BasePermission


class HasPermission(BasePermission):
    """
    Requires the authenticated user to hold a specific permission codename.

    Reads from JWT claim `permissions` (list of strings).
    Falls back to a DB check when the claim is absent (e.g. long-lived tokens).
    """

    def __init__(self, codename: str):
        self.codename = codename

    # DRF calls has_permission with an instance — we support class-level declaration
    # by making the class itself callable with the codename.
    def __class_getitem__(cls, codename: str):
        return cls(codename)

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False

        token = getattr(request, "auth", None)
        if token is not None:
            perms = token.get("permissions", [])
            # Only trust JWT claim when non-empty; fall through to DB on empty claim.
            if isinstance(perms, list) and perms:
                return self.codename in perms

        # DB fallback: long-lived tokens or test tokens without permissions claim
        from authentication.models import RolePermission

        return RolePermission.objects.filter(
            role__user_roles__user=request.user,
            permission__codename=self.codename,
        ).exists()


def require_permission(codename: str):
    """Factory that returns a configured HasPermission instance for use in permission_classes."""

    class _Perm(HasPermission):
        def __init__(self):
            super().__init__(codename)

    _Perm.__name__ = f"HasPermission[{codename}]"
    return _Perm


class IsSystemRole(BasePermission):
    """Blocks editing/deleting system roles."""

    def has_object_permission(self, request, view, obj) -> bool:
        from authentication.models import Role

        if isinstance(obj, Role) and obj.is_system_role:
            # Only allow safe methods on system roles
            return request.method in ("GET", "HEAD", "OPTIONS")
        return True
