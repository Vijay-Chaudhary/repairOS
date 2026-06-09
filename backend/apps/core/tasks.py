"""
Core Celery tasks.

dispatch_whatsapp_message — calls Meta Cloud API to send a WhatsApp template message.
"""

import json
import logging
import urllib.request
import urllib.error

from config.celery import app

logger = logging.getLogger(__name__)


@app.task(
    name="core.dispatch_whatsapp_message",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
)
def dispatch_whatsapp_message(
    self,
    *,
    phone: str,
    template_name: str,
    variables: dict,
) -> None:
    """
    Send a WhatsApp template message via Meta Cloud API.

    Required env vars: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN.
    If either is absent the task logs a warning and exits silently — this
    allows dev environments without WhatsApp credentials to run without errors.
    """
    from django.conf import settings

    phone_number_id: str = getattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "")
    access_token: str = getattr(settings, "WHATSAPP_ACCESS_TOKEN", "")

    if not phone_number_id or not access_token:
        logger.warning(
            "WhatsApp not configured (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN missing). "
            "Skipping template=%s phone=%s",
            template_name,
            phone,
        )
        return

    # Check DB override: if a NotificationTemplate row exists and is_active=False, skip.
    try:
        from core.models import NotificationTemplate
        tmpl_override = NotificationTemplate.objects.filter(template_name=template_name).first()
        if tmpl_override is not None and not tmpl_override.is_active:
            logger.debug("Template %s disabled by tenant override, skipping", template_name)
            return
    except Exception:
        pass  # DB errors must not block the notification path

    # Build Meta Cloud API payload.
    # Variables are passed as ordered body parameters.
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
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        logger.error(
            "WhatsApp HTTP error: template=%s phone=%s status=%s body=%s",
            template_name,
            phone,
            exc.code,
            body,
        )
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("WhatsApp send failed: template=%s phone=%s error=%s", template_name, phone, exc)
        raise self.retry(exc=exc)
