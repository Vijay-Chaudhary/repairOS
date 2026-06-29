import uuid

import pytest
from rest_framework import status


@pytest.fixture
def client_with_perms(db):
    """APIClient whose JWT carries the given permissions. Returns (client, user)."""
    from authentication.models import User
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    def _make(perms, shop_ids=None):
        suffix = uuid.uuid4().hex[:8]
        user = User.objects.create_user(
            email=f"u{suffix}@t.com", phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
            full_name="Tester", password="Pass@123",
        )
        refresh = RefreshToken.for_user(user)
        access = refresh.access_token
        access["permissions"] = perms
        if shop_ids is not None:
            access["shop_ids"] = [str(s) for s in shop_ids]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        return client, user

    return _make


def _notif(user, **kw):
    from core.models import Notification
    defaults = dict(type="new_lead", title="T", route="/x")
    defaults.update(kw)
    return Notification.objects.create(recipient=user, **defaults)


@pytest.mark.django_db
def test_list_unread_count_and_mark(client_with_perms):
    client, user = client_with_perms([])  # notifications need no special permission
    a = _notif(user, title="A")
    _notif(user, title="B")

    resp = client.get("/api/v1/notifications/unread-count/")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["data"]["count"] == 2

    resp = client.get("/api/v1/notifications/")
    assert resp.status_code == status.HTTP_200_OK

    resp = client.post(f"/api/v1/notifications/{a.id}/read/")
    assert resp.status_code == status.HTTP_200_OK
    assert client.get("/api/v1/notifications/unread-count/").json()["data"]["count"] == 1

    resp = client.post("/api/v1/notifications/read-all/")
    assert resp.status_code == status.HTTP_200_OK
    assert client.get("/api/v1/notifications/unread-count/").json()["data"]["count"] == 0


@pytest.mark.django_db
def test_cannot_touch_other_users_notification(client_with_perms):
    from authentication.models import User
    other = User.objects.create_user(email="o@t.com", phone="+919800000999", full_name="O", password="p")
    n = _notif(other, title="theirs")
    client, _ = client_with_perms([])
    assert client.post(f"/api/v1/notifications/{n.id}/read/").status_code == status.HTTP_404_NOT_FOUND
