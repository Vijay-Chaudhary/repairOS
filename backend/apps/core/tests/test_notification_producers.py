import uuid

import pytest


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")


def _user_with_perm(codename, shop):
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    u = User.objects.create_user(email=f"{uuid.uuid4().hex[:6]}@t.com",
                                 phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
                                 full_name="U", password="p")
    role = Role.objects.create(name=f"R-{uuid.uuid4().hex[:4]}", is_system_role=False)
    perm, _ = Permission.objects.get_or_create(codename=codename, defaults={"label": codename})
    RolePermission.objects.create(role=role, permission=perm)
    UserRole.objects.create(user=u, role=role, shop=shop)
    return u


@pytest.mark.django_db
def test_users_with_permission_scopes_by_shop(shop):
    from core.services import users_with_permission
    u = _user_with_perm("erp.inventory.view", shop)
    found = list(users_with_permission("erp.inventory.view", [shop.id]))
    assert u in found


@pytest.mark.django_db
def test_record_notifications_excludes_actor_and_dedups(shop):
    from core.models import Notification
    from core.services import record_notifications, notify_dedup
    actor = _user_with_perm("erp.inventory.view", shop)
    target = _user_with_perm("erp.inventory.view", shop)

    record_notifications([actor, target], type="low_stock", title="Low", body="", route="/inventory", exclude=actor)
    assert Notification.objects.filter(recipient=target).count() == 1
    assert Notification.objects.filter(recipient=actor).count() == 0

    assert notify_dedup(target, "low_stock", "/inventory") is True
