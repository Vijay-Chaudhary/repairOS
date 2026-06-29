import pytest


@pytest.mark.django_db
def test_notification_defaults_unread():
    from authentication.models import User
    from core.models import Notification
    u = User.objects.create_user(email="n@t.com", phone="+919800000123", full_name="N", password="p")
    n = Notification.objects.create(recipient=u, type="new_lead", title="New lead", route="/leads/x")
    assert n.read_at is None
    assert n.body == ""
    assert str(n)  # __str__ does not raise
