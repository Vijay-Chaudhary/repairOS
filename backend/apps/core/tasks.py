"""
Core Celery tasks for the notification pipeline.

dispatch_whatsapp_message — Meta Cloud API send, exponential retry (5/10/45 min),
                             writes NotificationLog, SMS fallback on exhaustion.
dispatch_sms_fallback     — MSG91 stub; logs if gateway not configured.
dispatch_email_message    — Django send_mail; console backend in dev.
"""

import json
import logging
import urllib.request
import urllib.error

from django.utils import timezone

from config.celery import app

logger = logging.getLogger(__name__)

# Retry countdowns per attempt index: 5 min, 10 min, 45 min
_RETRY_COUNTDOWNS = [300, 600, 2700]


def _retry_countdown(attempt: int) -> int:
    try:
        return _RETRY_COUNTDOWNS[attempt]
    except IndexError:
        return _RETRY_COUNTDOWNS[-1]


def _set_tenant_context(tenant_slug: str) -> None:
    """Register and activate tenant DB for this worker process."""
    from django.db import connections
    from core.context import set_tenant_db_alias
    from master.models import TenantDatabase

    alias = f"tenant_{tenant_slug}"
    if alias not in connections.databases:
        tdb = TenantDatabase.objects.using("default").get(tenant__slug=tenant_slug)
        connections.databases[alias] = {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": tdb.db_name,
            "HOST": tdb.db_host,
            "PORT": str(tdb.db_port),
            "USER": tdb.db_user,
            "PASSWORD": tdb.decrypt_password(),
            "CONN_MAX_AGE": 0,
            "CONN_HEALTH_CHECKS": False,
            "OPTIONS": {},
            "TIME_ZONE": None,
            "ATOMIC_REQUESTS": False,
            "AUTOCOMMIT": True,
            "TEST": {},
        }
    set_tenant_db_alias(alias)


# ── WhatsApp ──────────────────────────────────────────────────────────────────

@app.task(
    name="core.dispatch_whatsapp_message",
    bind=True,
    max_retries=3,
)
def dispatch_whatsapp_message(
    self,
    *,
    phone: str,
    template_name: str,
    variables: dict,
    log_id: str | None = None,
    tenant_slug: str = "",
) -> None:
    """
    Send a WhatsApp template message via Meta Cloud API.

    Required env vars: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN.
    Absent credentials → warning log + exit (safe in dev/local).
    Writes / updates NotificationLog for every attempt.
    After max_retries exhausted → queues SMS fallback.
    """
    from core.context import clear_tenant_context
    from django.conf import settings
    from core.models import NotificationLog

    if tenant_slug:
        try:
            _set_tenant_context(tenant_slug)
        except Exception as exc:
            logger.error("dispatch_whatsapp_message: cannot set tenant %s: %s", tenant_slug, exc)
            return

    now = timezone.now()

    # Resolve or create the log row (one row per logical send, updated per retry).
    log: NotificationLog | None = None
    if log_id:
        try:
            log = NotificationLog.objects.get(id=log_id)
        except NotificationLog.DoesNotExist:
            pass

    if log is None:
        log = NotificationLog.objects.create(
            template_name=template_name,
            channel=NotificationLog.Channel.WHATSAPP,
            recipient_phone=phone,
            status=NotificationLog.Status.QUEUED,
            attempt_count=0,
        )

    log.attempt_count += 1
    log.last_attempt_at = now
    log.status = NotificationLog.Status.QUEUED
    log.save(update_fields=["attempt_count", "last_attempt_at", "status", "updated_at"])

    phone_number_id: str = getattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "")
    access_token: str = getattr(settings, "WHATSAPP_ACCESS_TOKEN", "")

    if not phone_number_id or not access_token:
        logger.warning(
            "WhatsApp not configured (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN missing). "
            "Would send template=%s to phone=%s",
            template_name,
            phone,
        )
        log.status = NotificationLog.Status.FAILED
        log.failed_reason = "WhatsApp credentials not configured"
        log.save(update_fields=["status", "failed_reason", "updated_at"])
        return

    # Check DB override: if a NotificationTemplate row exists and is_active=False, skip.
    try:
        from core.models import NotificationTemplate
        tmpl_override = NotificationTemplate.objects.filter(template_name=template_name).first()
        if tmpl_override is not None and not tmpl_override.is_active:
            logger.debug("Template %s disabled by tenant override, skipping", template_name)
            log.status = NotificationLog.Status.FAILED
            log.failed_reason = "Template disabled by tenant"
            log.save(update_fields=["status", "failed_reason", "updated_at"])
            return
    except Exception:
        pass  # DB errors must not block the notification path

    # Build Meta Cloud API payload.
    body_params = [{"type": "text", "text": str(v)} for v in variables.values()]
    payload = {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": "en"},
            "components": [{"type": "body", "parameters": body_params}],
        },
    }

    url = f"https://graph.facebook.com/v18.0/{phone_number_id}/messages"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            msg_id = (result.get("messages") or [{}])[0].get("id", "")
            logger.info(
                "WhatsApp sent: template=%s phone=%s msg_id=%s",
                template_name,
                phone,
                msg_id,
            )
            log.status = NotificationLog.Status.SENT
            log.whatsapp_message_id = msg_id
            log.sent_at = timezone.now()
            log.save(update_fields=["status", "whatsapp_message_id", "sent_at", "updated_at"])

    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        logger.error(
            "WhatsApp HTTP error: template=%s phone=%s status=%s body=%s",
            template_name,
            phone,
            exc.code,
            body,
        )
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=_retry_countdown(self.request.retries))
        log.status = NotificationLog.Status.FAILED
        log.failed_reason = f"HTTP {exc.code}: {body[:500]}"
        log.save(update_fields=["status", "failed_reason", "updated_at"])
        dispatch_sms_fallback.delay(
            log_id=str(log.id), phone=phone, template_name=template_name,
            variables=variables, tenant_slug=tenant_slug,
        )

    except Exception as exc:
        logger.error("WhatsApp send failed: template=%s phone=%s error=%s", template_name, phone, exc)
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=_retry_countdown(self.request.retries))
        log.status = NotificationLog.Status.FAILED
        log.failed_reason = str(exc)[:500]
        log.save(update_fields=["status", "failed_reason", "updated_at"])
        dispatch_sms_fallback.delay(
            log_id=str(log.id), phone=phone, template_name=template_name,
            variables=variables, tenant_slug=tenant_slug,
        )

    finally:
        if tenant_slug:
            clear_tenant_context()


# ── SMS fallback ──────────────────────────────────────────────────────────────

@app.task(name="core.dispatch_sms_fallback", bind=True, max_retries=1)
def dispatch_sms_fallback(
    self,
    *,
    log_id: str,
    phone: str,
    template_name: str,
    variables: dict,
    tenant_slug: str = "",
) -> None:
    """
    SMS fallback triggered after WhatsApp retries are exhausted.
    Production: set SMS_GATEWAY_KEY to enable MSG91 sends.
    Dev/local: logs what would be sent; does not raise.
    """
    from core.context import clear_tenant_context
    from django.conf import settings
    from core.models import NotificationLog

    if tenant_slug:
        try:
            _set_tenant_context(tenant_slug)
        except Exception as exc:
            logger.error("dispatch_sms_fallback: cannot set tenant %s: %s", tenant_slug, exc)
            return

    try:
        gateway_key: str = getattr(settings, "SMS_GATEWAY_KEY", "")
        message = " | ".join([template_name] + [f"{k}={v}" for k, v in variables.items()])

        if not gateway_key:
            logger.warning(
                "SMS fallback: gateway not configured — would send to %s: %s",
                phone,
                message[:120],
            )
            try:
                log = NotificationLog.objects.get(id=log_id)
                log.failed_reason = (log.failed_reason + " | SMS fallback: gateway not configured")[:1000]
                log.save(update_fields=["failed_reason", "updated_at"])
            except Exception:
                pass
            return

        # MSG91 integration — replace with real HTTP call when key is available.
        logger.info("SMS fallback: would send to %s via MSG91 (not yet implemented)", phone)

    finally:
        if tenant_slug:
            clear_tenant_context()


# ── Email ─────────────────────────────────────────────────────────────────────

@app.task(name="core.dispatch_email_message", bind=True, max_retries=3)
def dispatch_email_message(
    self,
    *,
    to: str,
    subject: str,
    body: str,
    template_name: str = "email",
    tenant_slug: str = "",
) -> None:
    """
    Send a plain-text email via Django's mail backend.
    Dev: prints to console (EMAIL_BACKEND = console).
    Production: configure EMAIL_BACKEND + EMAIL_HOST_* in settings.
    Writes a NotificationLog row.
    """
    from core.context import clear_tenant_context
    from django.conf import settings
    from django.core.mail import send_mail
    from core.models import NotificationLog

    if tenant_slug:
        try:
            _set_tenant_context(tenant_slug)
        except Exception as exc:
            logger.error("dispatch_email_message: cannot set tenant %s: %s", tenant_slug, exc)
            return

    try:
        now = timezone.now()
        log = NotificationLog.objects.create(
            template_name=template_name,
            channel=NotificationLog.Channel.EMAIL,
            recipient_email=to,
            status=NotificationLog.Status.QUEUED,
            attempt_count=1,
            last_attempt_at=now,
        )

        from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@repaiross.app")

        try:
            send_mail(subject=subject, message=body, from_email=from_email, recipient_list=[to])
            log.status = NotificationLog.Status.SENT
            log.sent_at = timezone.now()
            log.save(update_fields=["status", "sent_at", "updated_at"])
            logger.info("Email sent: template=%s to=%s", template_name, to)
        except Exception as exc:
            logger.error("Email send failed: template=%s to=%s error=%s", template_name, to, exc)
            if self.request.retries < self.max_retries:
                raise self.retry(exc=exc, countdown=_retry_countdown(self.request.retries))
            log.status = NotificationLog.Status.FAILED
            log.failed_reason = str(exc)[:500]
            log.save(update_fields=["status", "failed_reason", "updated_at"])

    finally:
        if tenant_slug:
            clear_tenant_context()
