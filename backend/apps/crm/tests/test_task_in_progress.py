import uuid
from datetime import date

import pytest
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")


@pytest.fixture
def client_with_perms(db):
    from authentication.models import User
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    def _make(perms, shop_ids=None):
        suffix = uuid.uuid4().hex[:8]
        user = User.objects.create_user(
            email=f"u{suffix}@t.com", phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
            full_name="Tester", password="Pass@123",
        )
        access = RefreshToken.for_user(user).access_token
        access["permissions"] = perms
        if shop_ids is not None:
            access["shop_ids"] = [str(s) for s in shop_ids]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        return client, user

    return _make


@pytest.mark.django_db
def test_task_can_move_to_in_progress(shop, client_with_perms):
    from authentication.models import User
    from crm.models import FollowUpTask
    me = User.objects.create_user(email="me@t.com", phone="+919800000123", full_name="Me", password="p")
    task = FollowUpTask.objects.create(title="T", due_date=date.today(), assigned_to=me, status="pending")

    client, _ = client_with_perms(["crm.tasks.manage"], shop_ids=[shop.id])
    resp = client.patch(f"/api/v1/crm/tasks/{task.id}/", {"status": "in_progress"}, format="json")
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["data"]["status"] == "in_progress"
