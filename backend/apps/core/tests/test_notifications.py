"""
Tests for core notification pipeline.

Covers:
- send_whatsapp(): opt-out, empty phone, Celery dispatch
- dispatch_whatsapp_message task: no-config skip, is_active flag,
  correct API payload, retry on HTTP error
"""

import json
import urllib.error
from io import BytesIO
from unittest.mock import MagicMock, patch, call

import pytest
from django.test import override_settings


# ── send_whatsapp() ───────────────────────────────────────────────────────────

class TestSendWhatsApp:
    """Unit tests for the send_whatsapp() public API."""

    def test_empty_phone_is_a_no_op(self):
        from core.notifications import send_whatsapp
        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            send_whatsapp(phone="", template_name="job_created", variables={"a": "b"})
        mock_delay.assert_not_called()

    def test_none_phone_is_a_no_op(self):
        from core.notifications import send_whatsapp
        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            send_whatsapp(phone=None, template_name="job_created", variables={})
        mock_delay.assert_not_called()

    def test_opted_out_customer_skips(self):
        from core.notifications import send_whatsapp
        customer = MagicMock(whatsapp_optout=True)
        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            send_whatsapp(phone="+919900000001", template_name="job_created", variables={}, customer=customer)
        mock_delay.assert_not_called()

    def test_opted_in_customer_dispatches(self):
        from core.notifications import send_whatsapp
        customer = MagicMock(whatsapp_optout=False)
        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            send_whatsapp(phone="+919900000001", template_name="job_created", variables={"k": "v"}, customer=customer)
        mock_delay.assert_called_once_with(
            phone="+919900000001",
            template_name="job_created",
            variables={"k": "v"},
        )

    def test_no_customer_dispatches(self):
        from core.notifications import send_whatsapp
        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            send_whatsapp(phone="+919900000002", template_name="estimate_sent", variables={"name": "Alice"})
        mock_delay.assert_called_once()

    def test_customer_without_optout_attribute_dispatches(self):
        """Customer objects without whatsapp_optout attr must not crash."""
        from core.notifications import send_whatsapp
        customer = object()  # no whatsapp_optout attribute
        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            send_whatsapp(phone="+919900000003", template_name="job_closed", variables={}, customer=customer)
        mock_delay.assert_called_once()


# ── dispatch_whatsapp_message task ────────────────────────────────────────────

@pytest.mark.django_db
class TestDispatchWhatsAppMessageTask:
    """Tests for the Celery task that hits Meta Cloud API."""

    def _run_task(self, **kwargs):
        """Execute the task synchronously (bypasses Celery broker)."""
        from core.tasks import dispatch_whatsapp_message
        dispatch_whatsapp_message(**kwargs)

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="", WHATSAPP_ACCESS_TOKEN="")
    def test_skips_when_no_phone_number_id(self, caplog):
        with patch("urllib.request.urlopen") as mock_open:
            self._run_task(phone="+91990", template_name="job_created", variables={})
        mock_open.assert_not_called()

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="12345", WHATSAPP_ACCESS_TOKEN="")
    def test_skips_when_no_access_token(self, caplog):
        with patch("urllib.request.urlopen") as mock_open:
            self._run_task(phone="+91990", template_name="job_created", variables={})
        mock_open.assert_not_called()

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="12345", WHATSAPP_ACCESS_TOKEN="tok_abc")
    def test_skips_when_template_disabled(self, db):
        from core.models import NotificationTemplate
        NotificationTemplate.objects.create(template_name="job_created", is_active=False)
        with patch("urllib.request.urlopen") as mock_open:
            self._run_task(phone="+91990", template_name="job_created", variables={})
        mock_open.assert_not_called()

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="12345", WHATSAPP_ACCESS_TOKEN="tok_abc")
    def test_sends_when_template_enabled(self, db):
        from core.models import NotificationTemplate
        NotificationTemplate.objects.create(template_name="job_created", is_active=True)
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"messages": [{"id": "msg_123"}]}).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_resp):
            self._run_task(phone="+919900000001", template_name="job_created", variables={"name": "Bob"})
        mock_resp.read.assert_called_once()

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="12345", WHATSAPP_ACCESS_TOKEN="tok_abc")
    def test_sends_when_no_template_row(self, db):
        """No NotificationTemplate row == default active; must still send."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"messages": [{"id": "msg_456"}]}).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_resp):
            self._run_task(phone="+919900000001", template_name="estimate_sent", variables={"a": "1"})
        mock_resp.read.assert_called_once()

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="PH_ID", WHATSAPP_ACCESS_TOKEN="TOKEN")
    def test_api_payload_structure(self, db):
        """The task must send exactly the right JSON to Meta Cloud API."""
        captured = {}

        def fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["method"] = req.method
            captured["headers"] = dict(req.headers)
            captured["body"] = json.loads(req.data)
            mock_resp = MagicMock()
            mock_resp.read.return_value = json.dumps({"messages": [{"id": "x"}]}).encode()
            mock_resp.__enter__ = lambda s: s
            mock_resp.__exit__ = MagicMock(return_value=False)
            return mock_resp

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            self._run_task(
                phone="+919900000099",
                template_name="job_created",
                variables={"job_number": "J-001", "customer_name": "Alice"},
            )

        assert "PH_ID/messages" in captured["url"]
        assert captured["method"] == "POST"
        assert captured["headers"].get("Authorization") == "Bearer TOKEN"
        body = captured["body"]
        assert body["messaging_product"] == "whatsapp"
        assert body["to"] == "+919900000099"
        template = body["template"]
        assert template["name"] == "job_created"
        params = template["components"][0]["parameters"]
        assert params[0] == {"type": "text", "text": "J-001"}
        assert params[1] == {"type": "text", "text": "Alice"}

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="PH_ID", WHATSAPP_ACCESS_TOKEN="TOKEN")
    def test_retries_on_http_error(self, db):
        """An HTTP 500 from Meta must trigger Celery retry."""
        from core.tasks import dispatch_whatsapp_message

        http_err = urllib.error.HTTPError(
            url="https://graph.facebook.com/...",
            code=500,
            msg="Internal Server Error",
            hdrs={},
            fp=BytesIO(b"error body"),
        )
        with patch("urllib.request.urlopen", side_effect=http_err):
            with pytest.raises(Exception):  # retry raises
                dispatch_whatsapp_message.apply(
                    kwargs=dict(
                        phone="+91990",
                        template_name="job_created",
                        variables={},
                    ),
                    retries=3,  # exhaust retries so it raises instead of re-queuing
                )

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="PH_ID", WHATSAPP_ACCESS_TOKEN="TOKEN")
    def test_retries_on_connection_error(self, db):
        """A network-level exception must trigger Celery retry."""
        from core.tasks import dispatch_whatsapp_message

        with patch("urllib.request.urlopen", side_effect=OSError("Connection refused")):
            with pytest.raises(Exception):
                dispatch_whatsapp_message.apply(
                    kwargs=dict(phone="+91990", template_name="job_created", variables={}),
                    retries=3,
                )
