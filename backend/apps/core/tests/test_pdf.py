"""
core.pdf — rendering is separate from storage.

render_pdf_bytes() returns PDF bytes and touches no filesystem; the existing
render_and_save_pdf() wraps it and keeps its old signature so the Celery tasks
for salary slips, commission payouts and report exports are unaffected.

These tests are also the guard for the missing-native-library class of bug:
they fail loudly if WeasyPrint cannot render.
"""


def test_render_pdf_bytes_returns_a_real_pdf():
    from core.pdf import render_pdf_bytes

    pdf = render_pdf_bytes("pdf/repair_invoice.html", {})

    assert pdf[:4] == b"%PDF"
    assert len(pdf) > 500


def test_render_pdf_bytes_writes_nothing(settings, tmp_path):
    from core.pdf import render_pdf_bytes

    settings.MEDIA_ROOT = tmp_path
    render_pdf_bytes("pdf/repair_invoice.html", {})

    assert list(tmp_path.iterdir()) == []


def test_render_and_save_pdf_still_writes_the_file(settings, tmp_path):
    from core.pdf import render_and_save_pdf

    settings.MEDIA_ROOT = tmp_path
    settings.MEDIA_URL = "/media/"

    url = render_and_save_pdf("pdf/repair_invoice.html", {}, "invoices", "inv-test")

    assert url == "/media/invoices/inv-test.pdf"
    written = tmp_path / "invoices" / "inv-test.pdf"
    assert written.is_file()
    assert written.read_bytes()[:4] == b"%PDF"
