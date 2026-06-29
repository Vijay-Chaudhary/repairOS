"""
Tests for core notification pipeline.

Covers:
- send_whatsapp(): opt-out, empty phone, Celery dispatch
- dispatch_whatsapp_message task: no-config skip, is_active flag,
  correct API payload, retry on HTTP error, NotificationLog written,
  SMS fallback queued after exhaustion
- send_email(): empty address no-op, dispatch queued
- dispatch_email_message task: success + failure log
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
            tenant_slug="",
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
        """An HTTP 500 triggers retry on attempt 0 (retries=0 means first attempt)."""
        from core.tasks import dispatch_whatsapp_message

        http_err = urllib.error.HTTPError(
            url="https://graph.facebook.com/...",
            code=500,
            msg="Internal Server Error",
            hdrs={},
            fp=BytesIO(b"error body"),
        )
        with patch("urllib.request.urlopen", side_effect=http_err):
            with pytest.raises(Exception):  # retry raises when retries < max_retries
                dispatch_whatsapp_message.apply(
                    kwargs=dict(phone="+91990", template_name="job_created", variables={}),
                    retries=0,  # first attempt → still has retries left → must retry-raise
                )

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="PH_ID", WHATSAPP_ACCESS_TOKEN="TOKEN")
    def test_retries_exhausted_queues_sms_fallback(self, db):
        """After retries are exhausted, SMS fallback is queued instead of raising."""
        from core.tasks import dispatch_whatsapp_message, dispatch_sms_fallback

        with patch("urllib.request.urlopen", side_effect=OSError("Connection refused")):
            with patch.object(dispatch_sms_fallback, "delay") as mock_sms:
                # retries=3 == max_retries → exhausted path, no retry raise
                dispatch_whatsapp_message.apply(
                    kwargs=dict(phone="+91990", template_name="job_created", variables={}),
                    retries=3,
                )

        mock_sms.assert_called_once()

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="PH_ID", WHATSAPP_ACCESS_TOKEN="TOKEN")
    def test_retries_on_connection_error(self, db):
        """A network-level exception on attempt 0 triggers Celery retry."""
        from core.tasks import dispatch_whatsapp_message

        with patch("urllib.request.urlopen", side_effect=OSError("Connection refused")):
            with pytest.raises(Exception):
                dispatch_whatsapp_message.apply(
                    kwargs=dict(phone="+91990", template_name="job_created", variables={}),
                    retries=0,
                )

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="PH_ID", WHATSAPP_ACCESS_TOKEN="TOKEN")
    def test_notification_log_written_on_success(self, db):
        """A successful send must create a NotificationLog row with status=sent."""
        from core.tasks import dispatch_whatsapp_message
        from core.models import NotificationLog

        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"messages": [{"id": "msg_777"}]}).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)

        with patch("urllib.request.urlopen", return_value=mock_resp):
            dispatch_whatsapp_message(
                phone="+919900000099",
                template_name="job_received",
                variables={"customer_name": "Alice"},
            )

        log = NotificationLog.objects.get(template_name="job_received")
        assert log.status == NotificationLog.Status.SENT
        assert log.whatsapp_message_id == "msg_777"
        assert log.sent_at is not None
        assert log.attempt_count == 1
        assert log.recipient_phone == "+919900000099"

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="", WHATSAPP_ACCESS_TOKEN="")
    def test_notification_log_written_on_no_credentials(self, db):
        """No-credentials path must still create a log row with status=failed."""
        from core.tasks import dispatch_whatsapp_message
        from core.models import NotificationLog

        dispatch_whatsapp_message(
            phone="+919900000088",
            template_name="device_ready",
            variables={},
        )

        log = NotificationLog.objects.get(template_name="device_ready")
        assert log.status == NotificationLog.Status.FAILED
        assert "credentials" in log.failed_reason.lower()

    @override_settings(WHATSAPP_PHONE_NUMBER_ID="PH_ID", WHATSAPP_ACCESS_TOKEN="TOKEN")
    def test_sms_fallback_queued_after_retry_exhaustion(self, db):
        """After all retries fail, dispatch_sms_fallback must be queued."""
        from core.tasks import dispatch_whatsapp_message, dispatch_sms_fallback

        with patch("urllib.request.urlopen", side_effect=OSError("timeout")):
            with patch.object(dispatch_sms_fallback, "delay") as mock_sms:
                dispatch_whatsapp_message.apply(
                    kwargs=dict(phone="+91999", template_name="job_received", variables={}),
                    retries=3,
                )

        mock_sms.assert_called_once()
        call_kwargs = mock_sms.call_args.kwargs
        assert call_kwargs["phone"] == "+91999"
        assert call_kwargs["template_name"] == "job_received"


# ── send_email() ──────────────────────────────────────────────────────────────

class TestSendEmail:
    """Unit tests for the send_email() public API."""

    def test_empty_address_is_a_no_op(self):
        from core.notifications import send_email
        with patch("core.tasks.dispatch_email_message.delay") as mock_delay:
            send_email(to="", subject="Hello", body="World")
        mock_delay.assert_not_called()

    def test_none_address_is_a_no_op(self):
        from core.notifications import send_email
        with patch("core.tasks.dispatch_email_message.delay") as mock_delay:
            send_email(to=None, subject="Hello", body="World")
        mock_delay.assert_not_called()

    def test_valid_address_dispatches(self):
        from core.notifications import send_email
        with patch("core.tasks.dispatch_email_message.delay") as mock_delay:
            send_email(to="manager@shop.com", subject="Bill Due", body="Pay up", template_name="purchase_bill_due")
        mock_delay.assert_called_once_with(
            to="manager@shop.com",
            subject="Bill Due",
            body="Pay up",
            template_name="purchase_bill_due",
            tenant_slug="",
        )


# ── dispatch_email_message task ───────────────────────────────────────────────

@pytest.mark.django_db
class TestDispatchEmailMessageTask:

    def _run_task(self, **kwargs):
        from core.tasks import dispatch_email_message
        dispatch_email_message(**kwargs)

    def test_success_writes_sent_log(self, db):
        from core.models import NotificationLog
        with patch("django.core.mail.send_mail") as mock_mail:
            self._run_task(
                to="mgr@shop.com",
                subject="Test",
                body="Hello",
                template_name="purchase_bill_due",
            )
        mock_mail.assert_called_once()
        log = NotificationLog.objects.get(template_name="purchase_bill_due")
        assert log.status == NotificationLog.Status.SENT
        assert log.channel == NotificationLog.Channel.EMAIL
        assert log.recipient_email == "mgr@shop.com"
        assert log.sent_at is not None

    def test_failure_after_retries_writes_failed_log(self, db):
        from core.tasks import dispatch_email_message
        from core.models import NotificationLog

        with patch("django.core.mail.send_mail", side_effect=Exception("SMTP error")):
            dispatch_email_message.apply(
                kwargs=dict(to="bad@shop.com", subject="X", body="Y", template_name="purchase_bill_due"),
                retries=3,
            )

        log = NotificationLog.objects.filter(template_name="purchase_bill_due").last()
        assert log.status == NotificationLog.Status.FAILED
        assert "SMTP error" in log.failed_reason
