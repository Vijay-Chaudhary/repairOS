"""
Shared PDF render + save helper.

render_and_save_pdf(template_name, context, subdir, filename) -> str
  Renders a Django template to HTML, converts to PDF via WeasyPrint,
  writes the file under MEDIA_ROOT/<subdir>/<filename>.pdf, and returns
  the MEDIA_URL-relative path (e.g. "pdfs/payouts/payout-abc123.pdf").

All PDF Celery tasks use this function so the storage strategy is in one place.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def render_and_save_pdf(
    template_name: str,
    context: dict,
    subdir: str,
    filename: str,
) -> str:
    """
    Render *template_name* with *context*, write to MEDIA_ROOT/<subdir>/<filename>.pdf,
    and return the URL path relative to MEDIA_URL.

    Raises on any render or I/O failure (caller's Celery task handles retry).
    """
    from django.conf import settings
    from django.template.loader import render_to_string
    from weasyprint import HTML

    html_string = render_to_string(template_name, context)
    pdf_bytes = HTML(string=html_string, base_url=None).write_pdf()

    rel_path = f"{subdir}/{filename}.pdf"
    full_path = os.path.join(str(settings.MEDIA_ROOT), rel_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)

    with open(full_path, "wb") as fh:
        fh.write(pdf_bytes)

    logger.info("PDF saved: %s (%d bytes)", full_path, len(pdf_bytes))
    return f"{settings.MEDIA_URL}{rel_path}"
