# PDF Pipeline Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make document PDFs actually render and reach the browser, so the repair-invoice PDF button stops opening a blank page.

**Architecture:** WeasyPrint's native libraries are added to the backend image; `core/pdf.py` gains a bytes-returning render function that the existing save-to-disk helper wraps; the repair-invoice endpoint stops returning a `pdf_url` string and streams PDF bytes instead, rendering on demand when no file exists; the frontend fetches that response as a blob through the authenticated client and opens an object URL. `/media/` is served in development and in production so the other stored-PDF consumers (salary slips, commission payouts, report exports) work too.

**Tech Stack:** Python 3.11, Django 4.2, DRF, WeasyPrint, Celery, pytest + pytest-django, Next.js 14 App Router, TypeScript, Vitest, Docker Compose, nginx.

**Spec:** `docs/superpowers/specs/2026-08-01-sales-invoice-printing-design.md` — this plan implements **Stage 1 only** (§8 Suggested staging). `ShopBranding` and the sales documents are separate plans.

---

## Background the engineer needs

**The bug.** `backend/Dockerfile` line 9-13 installs `libpq-dev`, `gcc` and `curl` and nothing else. WeasyPrint needs Pango, Cairo and GDK-Pixbuf at runtime, so `import weasyprint` raises `OSError: cannot load library 'libgobject-2.0-0'`. Every `billing.generate_invoice_pdf` Celery task therefore fails, `RepairInvoice.pdf_url` stays `''`, and `frontend/src/app/(app)/invoices/[id]/page.tsx` calls `window.open('')`, which opens `about:blank`. Both the `dev` and `production` Dockerfile stages inherit that same base, so this is broken in production too.

**Response envelope.** `core/renderers.py:RepairOSRenderer` wraps every DRF `Response` in `{"success": true, "data": …}`. It only touches DRF `Response` objects — returning a plain Django `HttpResponse` bypasses it entirely, which is exactly what a binary PDF needs. Error paths must keep using DRF `Response` so the frontend still gets the envelope.

**Threading.** Django's ASGI handler already runs synchronous views in a thread pool executor, so a normal sync `APIView` does not block Daphne's event loop. Do **not** add `sync_to_async` — keep the view sync.

**Running the tests.** The container's environment sets `DJANGO_SETTINGS_MODULE=config.settings.local`, which overrides `pytest.ini`'s `config.settings.test` and makes tests run against the master DB, where tenant tables do not exist. Always pass the settings module explicitly:

```bash
docker exec -e DJANGO_SETTINGS_MODULE=config.settings.test repairos-backend-1 \
  pytest -o addopts="" apps/<app>/tests/<file>.py -q
```

`-o addopts=""` drops the 80% coverage gate that a partial run can never satisfy.

Frontend tests do **not** run inside the container — its `node_modules/rolldown` is missing the musl binding. Run them from the host `frontend/` directory. Lint is the reverse: run it in the container, because `.next/cache` is container-owned.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `backend/Dockerfile` | Native libs + fonts for WeasyPrint | 1 |
| `backend/apps/core/pdf.py` | `render_pdf_bytes()` (render) + `render_and_save_pdf()` (render + store) | 2 |
| `backend/apps/core/tests/test_pdf.py` | Proves the renderer produces real PDF bytes | 2 |
| `backend/apps/billing/views.py` | `RepairInvoicePdfView` streams bytes; `_invoice_pdf_bytes()` picks stored-vs-render | 3 |
| `backend/apps/billing/tests/test_billing.py` | `TestInvoicePdf` class appended | 3 |
| `backend/config/urls.py` | `/media/` route under `DEBUG` | 4 |
| `docker-compose.prod.yml` | `media_files` volume on backend + celery-worker + nginx | 5 |
| `infra/nginx/nginx.production.conf` | `/media/` location | 5 |
| `frontend/src/lib/api/client.ts` | `apiFetchBlob()` — authenticated binary fetch | 6 |
| `frontend/src/lib/api/billing.ts` | `downloadInvoicePdf()` replaces `getPdfUrl()` | 6 |
| `frontend/src/lib/api/__tests__/apiFetchBlob.test.ts` | Blob helper behaviour incl. JSON error path | 6 |
| `frontend/src/app/(app)/invoices/[id]/page.tsx` | Button uses blob + object URL | 7 |
| `frontend/src/app/(app)/invoices/__tests__/invoicePdf.test.tsx` | Button behaviour, success and failure | 7 |
| `docs/modules/billing.md`, `docs/modules/core.md` | Record the new behaviour | 8 |

---

## Task 1: Add WeasyPrint's native dependencies to the backend image

**Files:**
- Modify: `backend/Dockerfile:9-13`

- [x] **Step 1: Reproduce the failure**

Run:
```bash
docker exec repairos-backend-1 python -c "import weasyprint; print(weasyprint.__version__)"
```
Expected: `OSError: cannot load library 'libgobject-2.0-0'`. This is the bug — confirm it before changing anything.

- [x] **Step 2: Add the libraries and fonts**

Replace lines 9-13 of `backend/Dockerfile`:

```dockerfile
# libpq-dev/gcc: psycopg2 build. curl: healthchecks.
# The pango/cairo/gdk-pixbuf trio + shared-mime-info are WeasyPrint's runtime
# dependencies — without them `import weasyprint` raises OSError and every PDF
# task fails silently. Fonts: DejaVu covers Latin, Noto supplies ₹ (U+20B9) and
# Devanagari, so invoices render glyphs instead of tofu boxes.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq-dev \
        gcc \
        curl \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libcairo2 \
        libgdk-pixbuf-2.0-0 \
        shared-mime-info \
        fonts-dejavu-core \
        fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
```

- [x] **Step 3: Rebuild and restart the Python services**

Run:
```bash
docker compose build backend
docker compose up -d --force-recreate backend celery-worker celery-beat
```

Note: if your host ports collide, add your local port-override file with a second `-f` flag. The build itself is unaffected.

- [x] **Step 4: Verify the import in both images**

Run:
```bash
docker exec repairos-backend-1 python -c "import weasyprint; print('backend ok', weasyprint.__version__)"
docker exec repairos-celery-worker-1 python -c "import weasyprint; print('worker ok', weasyprint.__version__)"
```
Expected: two `ok` lines with a version number, no traceback.

- [x] **Step 5: The ten PDF tests that only failed locally should now pass**

Run:
```bash
docker exec -e DJANGO_SETTINGS_MODULE=config.settings.test repairos-backend-1 \
  pytest -o addopts="" apps/commissions/tests/test_commissions.py apps/hr/tests/test_hr.py apps/reports/tests/test_reports.py -q
```
Expected: `0 failed`. Before this task they failed with WeasyPrint import errors.

- [x] **Step 6: Commit**

```bash
git add backend/Dockerfile
git commit -m "fix(docker): install WeasyPrint's native libs and fonts

Pango/Cairo/GDK-Pixbuf were never installed, so import weasyprint raised
OSError and every PDF task failed silently, leaving pdf_url empty. Both
stages inherit the base image, so this was broken in production too."
```

---

## Task 2: Split rendering from storage in `core/pdf.py`

**Files:**
- Create: `backend/apps/core/tests/test_pdf.py`
- Modify: `backend/apps/core/pdf.py`

- [x] **Step 1: Write the failing test**

Create `backend/apps/core/tests/test_pdf.py`:

```python
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
```

Note: `pdf/repair_invoice.html` renders fine with an empty context — Django templates resolve missing variables to the empty string.

- [x] **Step 2: Run the test to verify it fails**

Run:
```bash
docker exec -e DJANGO_SETTINGS_MODULE=config.settings.test repairos-backend-1 \
  pytest -o addopts="" apps/core/tests/test_pdf.py -q
```
Expected: FAIL — `ImportError: cannot import name 'render_pdf_bytes' from 'core.pdf'` on the first two tests.

- [x] **Step 3: Implement the split**

Replace the body of `backend/apps/core/pdf.py` below the imports (keep lines 12-17 as they are):

```python
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
```

Also update the module docstring at the top of the file, replacing lines 1-10:

```python
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
```

- [x] **Step 4: Run the tests to verify they pass**

Run:
```bash
docker exec -e DJANGO_SETTINGS_MODULE=config.settings.test repairos-backend-1 \
  pytest -o addopts="" apps/core/tests/test_pdf.py -q
```
Expected: `3 passed`.

- [x] **Step 5: Confirm the existing PDF consumers still work**

Run:
```bash
docker exec -e DJANGO_SETTINGS_MODULE=config.settings.test repairos-backend-1 \
  pytest -o addopts="" apps/commissions/tests/test_commissions.py apps/reports/tests/test_reports.py -q
```
Expected: `0 failed` — `render_and_save_pdf` kept its signature and return value.

- [x] **Step 6: Commit**

```bash
git add backend/apps/core/pdf.py backend/apps/core/tests/test_pdf.py
git commit -m "refactor(pdf): split rendering from storage

render_pdf_bytes() returns bytes for streaming responses;
render_and_save_pdf() keeps its signature and now wraps it."
```

---

## Task 3: Stream PDF bytes from the repair-invoice endpoint

**Files:**
- Modify: `backend/apps/billing/views.py:146-162`
- Modify: `backend/apps/billing/tests/test_billing.py` (append a class at the end)

- [x] **Step 1: Write the failing tests**

Append to `backend/apps/billing/tests/test_billing.py`. The fixtures (`admin_client`, `repair_invoice`, `shop`) already exist in this file — that is why the tests live here rather than in a new file.

```python
# ──────────────────────────────────────────────────────────────────────────────
# TestInvoicePdf — the endpoint returns the PDF itself, never a URL
# ──────────────────────────────────────────────────────────────────────────────


class TestInvoicePdf:
    def _url(self, invoice) -> str:
        return f"/api/v1/billing/repair-invoices/{invoice.id}/pdf/"

    def test_renders_on_demand_when_pdf_url_is_empty(self, admin_client, repair_invoice):
        repair_invoice.pdf_url = ""
        repair_invoice.save(update_fields=["pdf_url"])

        res = admin_client.get(self._url(repair_invoice))

        assert res.status_code == status.HTTP_200_OK
        assert res["Content-Type"] == "application/pdf"
        assert res.content[:4] == b"%PDF"

    def test_streams_the_stored_file_when_present(
        self, admin_client, repair_invoice, settings, tmp_path
    ):
        settings.MEDIA_ROOT = tmp_path
        settings.MEDIA_URL = "/media/"
        stored = tmp_path / "invoices" / "stored.pdf"
        stored.parent.mkdir(parents=True)
        stored.write_bytes(b"%PDF-1.7 stored copy")

        repair_invoice.pdf_url = "/media/invoices/stored.pdf"
        repair_invoice.save(update_fields=["pdf_url"])

        res = admin_client.get(self._url(repair_invoice))

        assert res.status_code == status.HTTP_200_OK
        assert res.content == b"%PDF-1.7 stored copy"

    def test_falls_back_to_rendering_when_the_stored_file_is_gone(
        self, admin_client, repair_invoice, settings, tmp_path
    ):
        settings.MEDIA_ROOT = tmp_path
        settings.MEDIA_URL = "/media/"
        repair_invoice.pdf_url = "/media/invoices/vanished.pdf"
        repair_invoice.save(update_fields=["pdf_url"])

        res = admin_client.get(self._url(repair_invoice))

        assert res.status_code == status.HTTP_200_OK
        assert res.content[:4] == b"%PDF"

    def test_content_disposition_carries_the_invoice_number(self, admin_client, repair_invoice):
        res = admin_client.get(self._url(repair_invoice))

        assert repair_invoice.invoice_number in res["Content-Disposition"]
        assert res["Content-Disposition"].startswith("inline;")

    def test_unknown_invoice_returns_404(self, admin_client):
        import uuid

        res = admin_client.get(f"/api/v1/billing/repair-invoices/{uuid.uuid4()}/pdf/")

        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_render_failure_returns_the_json_envelope(
        self, admin_client, repair_invoice, monkeypatch
    ):
        """A render crash must produce a readable error, never an empty body."""
        from billing import views

        def boom(_invoice):
            raise RuntimeError("weasyprint exploded")

        monkeypatch.setattr(views, "_invoice_pdf_bytes", boom)

        res = admin_client.get(self._url(repair_invoice))

        assert res.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert res.data["code"] == "PDF_RENDER_FAILED"
```

- [x] **Step 2: Run the tests to verify they fail**

Run:
```bash
docker exec -e DJANGO_SETTINGS_MODULE=config.settings.test repairos-backend-1 \
  pytest -o addopts="" apps/billing/tests/test_billing.py -q -k TestInvoicePdf
```
Expected: FAIL — the current view returns JSON, so `Content-Type` is `application/json` and `res.content` starts with `{"success"`.

- [x] **Step 3: Replace the view**

In `backend/apps/billing/views.py`, replace the whole `RepairInvoicePdfView` class (lines 146-162) with:

```python
def _invoice_pdf_bytes(invoice) -> bytes:
    """
    The stored file when it exists on disk, otherwise a fresh render.

    No staleness check: a stored file is authoritative. Regeneration stays the
    job of billing.generate_invoice_pdf; this fallback exists for files that
    were never produced (e.g. the task failed) or are missing on this host.
    """
    from pathlib import Path

    from django.conf import settings
    from django.utils import timezone

    from core.pdf import render_pdf_bytes

    if invoice.pdf_url:
        rel_path = invoice.pdf_url.removeprefix(settings.MEDIA_URL)
        stored = Path(str(settings.MEDIA_ROOT)) / rel_path
        if stored.is_file():
            return stored.read_bytes()

    return render_pdf_bytes(
        "pdf/repair_invoice.html",
        {
            "invoice": invoice,
            "shop": invoice.shop,
            "items": invoice.items.all(),
            "generated_at": timezone.now().strftime("%d %b %Y %H:%M"),
        },
    )


class RepairInvoicePdfView(APIView):
    """
    Returns the PDF itself, not a URL.

    The previous {"pdf_url": …} contract meant an empty string reached the
    browser whenever generation had failed, and window.open('') opens a blank
    tab. Streaming bytes removes that failure mode: the caller gets a PDF or a
    readable error.

    HttpResponse (not DRF Response) deliberately bypasses RepairOSRenderer, so
    the body is raw PDF rather than a JSON envelope. Error paths keep using
    Response so the frontend still receives the envelope it expects.
    """

    permission_classes = [IsAuthenticated, require_permission("billing.repair_invoices.view")]

    def get(self, request: Request, invoice_id: str):
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)

        qs = RepairInvoice.objects.select_related("job", "customer", "shop").prefetch_related("items")
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)

        try:
            invoice = qs.get(id=invoice_id)
        except RepairInvoice.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            pdf_bytes = _invoice_pdf_bytes(invoice)
        except Exception:
            logger.exception("Invoice PDF render failed for %s", invoice_id)
            return Response(
                {
                    "code": "PDF_RENDER_FAILED",
                    "message": "Could not generate the PDF. Please try again.",
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        filename = f"{invoice.invoice_number.replace('/', '-')}.pdf"
        response["Content-Disposition"] = f'inline; filename="{filename}"'
        return response
```

`logging`, `HttpResponse`, `status`, `Response` and `require_permission` are already imported at the top of this file (lines 7-18). Confirm `logger = logging.getLogger(__name__)` exists near the top; if it does not, add it directly below the imports.

- [x] **Step 4: Run the tests to verify they pass**

Run:
```bash
docker exec -e DJANGO_SETTINGS_MODULE=config.settings.test repairos-backend-1 \
  pytest -o addopts="" apps/billing/tests/test_billing.py -q
```
Expected: `0 failed` — the new `TestInvoicePdf` class passes and no existing billing test regresses.

- [x] **Step 5: Commit**

```bash
git add backend/apps/billing/views.py backend/apps/billing/tests/test_billing.py
git commit -m "feat(billing): stream invoice PDFs instead of returning a URL

The endpoint now returns the PDF bytes, rendering on demand when no stored
file exists. This removes the empty-pdf_url path that made the frontend open
a blank tab."
```

---

## Task 4: Serve `/media/` in development

**Files:**
- Modify: `backend/config/urls.py`

The other stored-PDF consumers — salary slips, commission payouts, report exports — still hand out `/media/...` URLs. Daphne serves nothing at that path today, so those URLs 404 even once WeasyPrint works.

**No unit test for this step.** `django.conf.urls.static.static()` is evaluated at import time from `settings.DEBUG`; asserting its output would be testing Django's behaviour, not ours. It is verified by request below.

- [x] **Step 1: Add the route**

In `backend/config/urls.py`, append after the existing `if settings.DEBUG and "debug_toolbar" …` block at the end of the file:

```python
if settings.DEBUG:
    # Stored PDFs (salary slips, commission payouts, report exports) are written
    # under MEDIA_ROOT and handed to the browser as /media/... URLs. Daphne serves
    # nothing there by default, so those links 404 in development. Production
    # serves this path from nginx instead — see infra/nginx/nginx.production.conf.
    from django.conf.urls.static import static

    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
```

- [x] **Step 2: Restart the backend and verify a media file is reachable**

Run:
```bash
docker exec repairos-backend-1 sh -c 'mkdir -p /app/media/probe && printf "%%PDF-1.7 probe" > /app/media/probe/probe.pdf'
docker compose restart backend
sleep 20
curl -s -o /dev/null -w "media probe -> %{http_code}\n" http://localhost:8000/media/probe/probe.pdf
```
Expected: `media probe -> 200`. Adjust the port if your stack publishes the backend elsewhere.

- [x] **Step 3: Clean up the probe file**

```bash
docker exec repairos-backend-1 rm -rf /app/media/probe
```

- [x] **Step 4: Commit**

```bash
git add backend/config/urls.py
git commit -m "fix(urls): serve MEDIA_ROOT under DEBUG

Stored PDF URLs 404'd in development because nothing served /media/."
```

---

## Task 5: Production media volume and nginx location

**Files:**
- Modify: `docker-compose.prod.yml` (backend service ~line 123, celery-worker ~line 149, nginx ~line 244, volumes ~line 261)
- Modify: `infra/nginx/nginx.production.conf` (after the `/static/` block, line 76-80)

In production the Celery worker writes PDFs to its **own** container filesystem while nginx serves from a different one, so stored files are unreachable no matter what. A shared volume fixes it.

- [x] **Step 1: Mount a shared media volume on the writer and the reader**

In `docker-compose.prod.yml`, the `backend` service `volumes:` block currently reads:

```yaml
    volumes:
      - static_files:/app/staticfiles
```

Change it to:

```yaml
    volumes:
      - static_files:/app/staticfiles
      - media_files:/app/media
```

The `celery-worker` service has no `volumes:` block. Add one directly after its `command:` block and before `stop_grace_period:`:

```yaml
    volumes:
      - media_files:/app/media
```

- [x] **Step 2: Give nginx read-only access**

In the `nginx` service `volumes:` block, which currently reads:

```yaml
    volumes:
      - ./infra/nginx/nginx.production.conf:/etc/nginx/conf.d/default.conf:ro
      - static_files:/app/staticfiles:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - certbot_webroot:/var/www/certbot
```

add the media volume:

```yaml
    volumes:
      - ./infra/nginx/nginx.production.conf:/etc/nginx/conf.d/default.conf:ro
      - static_files:/app/staticfiles:ro
      - media_files:/app/media:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - certbot_webroot:/var/www/certbot
```

- [x] **Step 3: Declare the volume**

At the bottom of `docker-compose.prod.yml`, the `volumes:` list currently ends:

```yaml
volumes:
  postgres_data:
  redis_data:
  minio_data:
  static_files:
  certbot_webroot:
```

Add `media_files:`:

```yaml
volumes:
  postgres_data:
  redis_data:
  minio_data:
  static_files:
  media_files:
  certbot_webroot:
```

- [x] **Step 4: Add the nginx location**

In `infra/nginx/nginx.production.conf`, directly after the `/static/` location block (lines 75-80), add:

```nginx
    # Generated PDFs (salary slips, commission payouts, report exports) written
    # by the Celery worker to the shared media_files volume. Invoices do not use
    # this path — they stream from the API — so nothing here is hot.
    location /media/ {
        alias /app/media/;
        expires 1h;
        add_header Cache-Control "private";
    }
```

- [x] **Step 5: Validate the compose file and the nginx config parse**

Run:
```bash
docker compose -f docker-compose.prod.yml config >/dev/null && echo "compose ok"
docker run --rm -v "$PWD/infra/nginx/nginx.production.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine nginx -t 2>&1 | tail -3
```
Expected: `compose ok`, and nginx reporting `syntax is ok` / `test is successful`. The nginx test may warn about missing upstreams — that is fine, syntax is what matters here.

- [x] **Step 6: Commit**

```bash
git add docker-compose.prod.yml infra/nginx/nginx.production.conf
git commit -m "fix(infra): share a media volume between worker, backend and nginx

The Celery worker wrote PDFs to its own filesystem and nginx served a
different one, so stored files were unreachable in production."
```

---

## Task 6: Authenticated blob fetch on the frontend

**Files:**
- Modify: `frontend/src/lib/api/client.ts` (add after `apiFetch`, before `apiGet` at line 130)
- Modify: `frontend/src/lib/api/billing.ts:205-206`
- Create: `frontend/src/lib/api/__tests__/apiFetchBlob.test.ts`

`window.open(url)` sends no `Authorization` header and no `X-Tenant-Slug`, so the PDF endpoint cannot be opened directly. Fetch it through the authenticated client and open an object URL instead.

- [x] **Step 1: Write the failing test**

Create `frontend/src/lib/api/__tests__/apiFetchBlob.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetchBlob, ApiError } from '../client';

const accessToken = 'test-access-token';
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      accessToken,
      setAccessToken: vi.fn(),
      logout: vi.fn(),
    }),
  },
}));

describe('apiFetchBlob', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the blob and sends the bearer token', async () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/pdf' }),
      blob: async () => blob,
    } as unknown as Response);

    const result = await apiFetchBlob('/billing/repair-invoices/abc/pdf/');

    expect(result).toBe(blob);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${accessToken}`);
  });

  it('throws ApiError carrying the server message when the server returns the JSON envelope', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        success: false,
        error: { code: 'PDF_RENDER_FAILED', message: 'Could not generate the PDF. Please try again.' },
      }),
    } as unknown as Response);

    await expect(apiFetchBlob('/billing/repair-invoices/abc/pdf/')).rejects.toMatchObject({
      code: 'PDF_RENDER_FAILED',
      message: 'Could not generate the PDF. Please try again.',
      status: 500,
    });
  });

  it('throws ApiError on a non-JSON failure', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      headers: new Headers({ 'Content-Type': 'text/html' }),
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);

    await expect(apiFetchBlob('/x/')).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run from the `frontend/` directory on the host:
```bash
npx vitest run src/lib/api/__tests__/apiFetchBlob.test.ts
```
Expected: FAIL — `apiFetchBlob` is not exported from `../client`.

- [x] **Step 3: Implement the helper**

In `frontend/src/lib/api/client.ts`, insert between `apiFetch` (ends line 128) and `apiGet` (line 130):

```typescript
/**
 * Fetch a binary response (PDF) with the same auth as apiFetch.
 *
 * Needed because window.open() sends neither Authorization nor X-Tenant-Slug.
 * On failure the server still replies with the JSON envelope, so the error is
 * unwrapped into an ApiError the caller can show — rather than a blank tab.
 */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {
    ...(DEV_TENANT_SLUG ? { 'X-Tenant-Slug': DEV_TENANT_SLUG } : {}),
  };

  const token = useAuthStore.getState().accessToken;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = path.startsWith('http') ? path : `${BASE_URL}/api/v1${path}`;

  const makeRequest = async (authHeader?: string): Promise<Response> => {
    if (authHeader) headers['Authorization'] = `Bearer ${authHeader}`;
    return fetch(url, { method: 'GET', headers, credentials: 'include' });
  };

  let response = await makeRequest();

  if (response.status === 401) {
    const newToken = await silentRefresh();
    if (!newToken) throw new ApiError('NOT_AUTHENTICATED', 'Session expired', 401);
    response = await makeRequest(newToken);
  }

  if (!response.ok) {
    const data: ApiResponse<never> | null = await response.json().catch(() => null);
    if (data && !data.success) {
      throw new ApiError(data.error.code, data.error.message, response.status, data.error.fields);
    }
    throw new ApiError('DOWNLOAD_FAILED', 'Could not download the file', response.status);
  }

  return response.blob();
}
```

- [x] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/lib/api/__tests__/apiFetchBlob.test.ts
```
Expected: `3 passed`.

- [x] **Step 5: Replace `getPdfUrl` in the billing client**

In `frontend/src/lib/api/billing.ts`, replace lines 205-206:

```typescript
  getPdfUrl: (id: string) =>
    apiGet<{ pdf_url: string }>(`/billing/repair-invoices/${id}/pdf/`),
```

with:

```typescript
  downloadInvoicePdf: (id: string) =>
    apiFetchBlob(`/billing/repair-invoices/${id}/pdf/`),
```

Add `apiFetchBlob` to the existing import from `./client` at the top of the file.

- [x] **Step 6: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: one error in `invoices/[id]/page.tsx` — `getPdfUrl` no longer exists. That is Task 7.

- [x] **Step 7: Commit**

```bash
git add frontend/src/lib/api/client.ts frontend/src/lib/api/billing.ts frontend/src/lib/api/__tests__/apiFetchBlob.test.ts
git commit -m "feat(api): add apiFetchBlob for authenticated binary downloads"
```

---

## Task 7: Point the invoice page at the blob download

**Files:**
- Modify: `frontend/src/app/(app)/invoices/[id]/page.tsx:54-66`
- Create: `frontend/src/app/(app)/invoices/__tests__/invoicePdf.test.tsx`

- [x] **Step 1: Write the failing test**

Create `frontend/src/app/(app)/invoices/__tests__/invoicePdf.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvoiceDetailPage from '../[id]/page';

const authState = {
  hasPermission: () => true,
  hasAnyPermission: () => true,
  user: { id: 'u-1' },
};
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'inv-1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));

const getInvoice = vi.fn();
const downloadInvoicePdf = vi.fn();
vi.mock('@/lib/api/billing', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/billing')>();
  return {
    ...actual,
    billingApi: {
      getInvoice: (...a: unknown[]) => getInvoice(...a),
      downloadInvoicePdf: (...a: unknown[]) => downloadInvoicePdf(...a),
      sendWhatsapp: vi.fn(),
    },
  };
});

const INVOICE = {
  id: 'inv-1',
  invoice_number: 'HTA-INV-2026-08-0001',
  status: 'paid',
  shop_id: 'shop-1',
  customer_name: 'Rakesh Traders',
  subtotal: 500,
  discount_amount: 0,
  cgst: 45,
  sgst: 45,
  igst: 0,
  grand_total: 590,
  amount_paid: 590,
  amount_outstanding: 0,
  created_at: '2026-08-01T10:00:00Z',
  items: [],
  payments: [],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InvoiceDetailPage />
    </QueryClientProvider>,
  );
}

describe('Invoice PDF button', () => {
  beforeEach(() => {
    getInvoice.mockReset().mockResolvedValue(INVOICE);
    downloadInvoicePdf.mockReset().mockResolvedValue(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    toastError.mockReset();
    vi.stubGlobal('open', vi.fn());
    // jsdom implements neither of these; assign the methods directly rather
    // than replacing the whole URL global, which would break `new URL()`.
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
  });

  it('opens an object URL built from the downloaded blob', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /pdf/i }));

    await waitFor(() => expect(downloadInvoicePdf).toHaveBeenCalledWith('inv-1'));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('blob:mock-url', '_blank', 'noreferrer'));
  });

  it('shows the server error and opens nothing when the download fails', async () => {
    const { ApiError } = await import('@/lib/api/client');
    downloadInvoicePdf.mockRejectedValue(
      new ApiError('PDF_RENDER_FAILED', 'Could not generate the PDF. Please try again.', 500),
    );

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /pdf/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Could not generate the PDF. Please try again.'),
    );
    expect(window.open).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run "src/app/(app)/invoices/__tests__/invoicePdf.test.tsx"
```
Expected: FAIL — the page still calls `billingApi.getPdfUrl`, which the mock does not provide.

- [x] **Step 3: Rewrite the handler**

In `frontend/src/app/(app)/invoices/[id]/page.tsx`, replace `handleDownloadPdf` (lines 54-66):

```tsx
  async function handleDownloadPdf() {
    if (pdfLoading) return;
    setPdfLoading(true);
    let objectUrl: string | undefined;
    try {
      const blob = await billingApi.downloadInvoicePdf(id);
      objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank', 'noreferrer');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not download the PDF — please try again');
    } finally {
      setPdfLoading(false);
      // Revoke on the next tick so the opened tab has already claimed the blob.
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl!), 60_000);
    }
  }
```

`ApiError` and `toast` are already imported in this file.

- [x] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run "src/app/(app)/invoices/__tests__/invoicePdf.test.tsx"
```
Expected: `2 passed`.

- [x] **Step 5: Typecheck and lint**

Run:
```bash
npx tsc --noEmit
docker exec repairos-frontend-1 npx next lint
```
Expected: no output from `tsc`; `✔ No ESLint warnings or errors`.

- [x] **Step 6: Commit**

```bash
git add "frontend/src/app/(app)/invoices/[id]/page.tsx" "frontend/src/app/(app)/invoices/__tests__/invoicePdf.test.tsx"
git commit -m "fix(invoices): download the PDF as a blob instead of opening a URL

Opening pdf_url meant a blank tab whenever generation had failed. The button
now fetches the PDF with auth and opens an object URL, surfacing server
errors in a toast."
```

---

## Task 8: Documentation and full verification

**Files:**
- Modify: `docs/modules/billing.md`
- Modify: `docs/modules/core.md`

- [x] **Step 1: Record the endpoint change in the billing module doc**

Append to `docs/modules/billing.md`:

```markdown
### Invoice PDFs (2026-08-01)

`GET /api/v1/billing/repair-invoices/<id>/pdf/` returns the PDF **bytes**
(`application/pdf`), not `{"pdf_url": …}`. It streams the stored file when one
exists under `MEDIA_ROOT` and renders on demand otherwise, so a failed or
never-run `generate_invoice_pdf` task no longer produces a blank tab. Render
failures return 500 `PDF_RENDER_FAILED` in the standard envelope.
```

- [x] **Step 2: Record the helper split in the core module doc**

Append to `docs/modules/core.md`:

```markdown
### PDF helpers (2026-08-01)

`core.pdf` exposes two functions: `render_pdf_bytes(template, context)` returns
PDF bytes with no I/O (use it when streaming a response), and
`render_and_save_pdf(...)` wraps it to write under `MEDIA_ROOT` and return a
`/media/...` URL (used by the salary-slip, commission-payout and report-export
Celery tasks). WeasyPrint's native libraries are installed in the base image —
see `backend/Dockerfile`.
```

- [x] **Step 3: Run the full backend suite**

Run:
```bash
docker exec -e DJANGO_SETTINGS_MODULE=config.settings.test repairos-backend-1 \
  sh -c 'pytest -o addopts="" -q 2>&1 | tail -5'
```
Expected: `0 failed`. The 10 PDF tests that used to fail here now pass — Task 1 fixed their root cause.

- [x] **Step 4: Run the full frontend suite**

Run from `frontend/` on the host:
```bash
npx vitest run 2>&1 | tail -6
npx tsc --noEmit
```
Expected: all test files pass, no `tsc` output.

- [x] **Step 5: Verify in the browser**

1. Open the app, sign in, and go to an invoice detail page (`/invoices`, then any row).
2. Click the PDF button.
3. Expected: a new tab showing the rendered tax invoice — **not** a blank page.
4. Check the tab's URL starts with `blob:`.

> **Verified 2026-08-08** via Playwright against the dev stack, driving the real
> UI (login form → `/invoices` → row → PDF button) as `billing@demo.com` on the
> `demo` tenant. Results:
>
> - `GET /billing/repair-invoices/<id>/pdf/` → `200 application/pdf`,
>   `Content-Disposition: inline; filename="SDEL-INV-2026-07-0022.pdf"`.
> - The click produced one `blob:http://localhost:3000/…` object URL,
>   `type=application/pdf`, 12222 bytes, starting `%PDF-1.7`, and opened one new tab.
> - No error toast, no console errors.
>
> The tab's own `location` could not be asserted directly: `window.open(url, '_blank',
> 'noreferrer')` gives the popup an opaque URL in headless Chromium, so the check
> instruments `URL.createObjectURL` instead — same click, same blob, observable.
>
> Rendered output was also inspected as an image (`pdftoppm`): header, PAID badge,
> billed-by/to, line items, CGST/SGST split and totals all render, and ₹ (U+20B9)
> appears as a glyph rather than tofu — `pdffonts` shows subsetted
> `Noto-Sans`/`Noto-Sans-Bold` embedded, confirming the Dockerfile's font choices.
>
> The 2026-08-02 blocker (`TENANT_CRED_ENCRYPTION_KEY` mismatch → `InvalidToken`
> on login, empty tenant DBs) is gone: all three tenants decrypt, and `demo` has
> 8 users and 22 invoices.

- [x] **Step 6: Commit**

```bash
git add docs/modules/billing.md docs/modules/core.md
git commit -m "docs(modules): record the PDF pipeline fix"
```

---

## Done when

- `import weasyprint` succeeds in the backend and celery-worker containers.
- `pytest` reports 0 failures for the whole backend suite, including the 10 PDF tests that previously failed locally.
- Clicking the PDF button on a repair invoice opens a rendered PDF.
- A stored `/media/...` PDF URL returns 200 in development.
- `docker compose -f docker-compose.prod.yml config` parses and the nginx config passes `nginx -t`.

## Follow-up plans (not this one)

- **Stage 2 — `ShopBranding`:** per-shop logo, footer, bank details and signature with tenant fallback, wired into the invoice template.
- **Stage 3 — sales documents:** `sales_invoice.html`, `GET /pos/sales/<id>/invoice.pdf/`, the 80mm receipt print path, and the two POS buttons.
