"""
Shared PDF rendering helpers.

render_pdf_bytes(template_name, context) -> bytes
  Renders a Django template to HTML and converts it to PDF via WeasyPrint.
  No I/O — use this when streaming a PDF straight back in a response.

render_and_save_pdf(template_name, context, subdir, filename) -> str
  Wraps render_pdf_bytes, writes the file under MEDIA_ROOT/<subdir>/<filename>.pdf,
  and returns the MEDIA_URL-relative path (e.g. "/media/payouts/payout-abc123.pdf").

All PDF Celery tasks use render_and_save_pdf so the storage strategy stays in
one place.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def render_pdf_bytes(template_name: str, context: dict) -> bytes:
    """
    Render *template_name* with *context* and return the PDF as bytes.

    Touches no filesystem — callers that need a stored file use
    render_and_save_pdf(); callers streaming a response use this directly.
    """
    from django.template.loader import render_to_string
    from weasyprint import HTML

    html_string = render_to_string(template_name, context)
    return HTML(string=html_string, base_url=None).write_pdf()


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

    pdf_bytes = render_pdf_bytes(template_name, context)

    rel_path = f"{subdir}/{filename}.pdf"
    full_path = os.path.join(str(settings.MEDIA_ROOT), rel_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)

    with open(full_path, "wb") as fh:
        fh.write(pdf_bytes)

    logger.info("PDF saved: %s (%d bytes)", full_path, len(pdf_bytes))
    return f"{settings.MEDIA_URL}{rel_path}"
