# Fault Template Default Parts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `FaultTemplatePart` rows writable via the API and auto-populate them as `JobSparePartRequest` rows whenever a job is created from a template.

**Architecture:** Three-layer change. (1) BE: remove `read_only` from `FaultTemplateSerializer.parts`, add `update_fault_template()` service that replaces parts atomically, and extend `create_job()` to seed `JobSparePartRequest` rows from the template's parts. (2) FE: add a `FaultTemplatePart` interface + extend `FaultTemplate` type, update API call signatures, and add a `useFieldArray`-backed repeating-row UI inside `TemplateDialog`. No new npm dependencies.

**Tech Stack:** Django 4.2, DRF, pytest-django; Next.js 14 App Router, React Hook Form `useFieldArray`, Zod, Tailwind CSS.

---

## File map

| Action | Path |
|--------|------|
| Modify | `backend/apps/repair/serializers.py` |
| Modify | `backend/apps/repair/services.py` |
| Modify | `backend/apps/repair/views.py` |
| Create | `backend/apps/repair/tests/test_fault_templates.py` |
| Modify | `frontend/src/lib/api/repair.ts` |
| Modify | `frontend/src/app/(app)/settings/fault-templates/page.tsx` |
| Modify | `docs/ALIGNMENT_AUDIT.md` |

---

## Task 1: Make `FaultTemplateSerializer.parts` writable + add `update_fault_template` service

**Files:**
- Modify: `backend/apps/repair/serializers.py`
- Modify: `backend/apps/repair/services.py`
- Modify: `backend/apps/repair/views.py`

### Serializer change

- [ ] **Step 1: Remove the `read_only` override from `FaultTemplateSerializer`**

In `backend/apps/repair/serializers.py`, the current `FaultTemplateSerializer` has:

```python
class FaultTemplateSerializer(serializers.ModelSerializer):
    shop_id = serializers.PrimaryKeyRelatedField(source="shop", queryset=Shop.objects.all())
    parts = FaultTemplatePartSerializer(many=True, required=False, default=list)

    class Meta:
        model = FaultTemplate
        fields = [
            "id", "shop_id", "name", "device_type", "device_brand",
            "problem_description", "default_sc", "estimated_duration_hours",
            "is_active", "parts", "created_at",
        ]
        read_only_fields = ["id", "created_at"]
        extra_kwargs = {"parts": {"read_only": True}}   # ← REMOVE THIS LINE
```

Replace the entire class with:

```python
class FaultTemplateSerializer(serializers.ModelSerializer):
    shop_id = serializers.PrimaryKeyRelatedField(source="shop", queryset=Shop.objects.all())
    parts = FaultTemplatePartSerializer(many=True, required=False, default=list)

    class Meta:
        model = FaultTemplate
        fields = [
            "id", "shop_id", "name", "device_type", "device_brand",
            "problem_description", "default_sc", "estimated_duration_hours",
            "is_active", "parts", "created_at",
        ]
        read_only_fields = ["id", "created_at"]
```

### Service change

- [ ] **Step 2: Add `update_fault_template()` to `services.py`**

Add after `create_fault_template()` (around line 610):

```python
def update_fault_template(
    template: FaultTemplate, data: dict, parts_data: list | None, user
) -> FaultTemplate:
    """
    Update template fields. If parts_data is not None (i.e. explicitly sent),
    replace all FaultTemplatePart rows atomically. parts_data=[] clears them.
    """
    with transaction.atomic():
        for attr, value in data.items():
            setattr(template, attr, value)
        template.save()
        if parts_data is not None:
            template.parts.all().delete()
            for part in parts_data:
                FaultTemplatePart.objects.create(template=template, **part)
    _write_audit(user, AuditLog.Action.UPDATE, "FaultTemplate", template.id)
    return template
```

### View change

- [ ] **Step 3: Update `FaultTemplateViewSet.partial_update()` to call the service**

Replace the existing `partial_update` method:

```python
def partial_update(self, request, pk=None):
    try:
        template = self.get_queryset().get(pk=pk)
    except FaultTemplate.DoesNotExist:
        from rest_framework.exceptions import NotFound
        raise NotFound("Fault template not found.")
    serializer = FaultTemplateSerializer(template, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    vd = serializer.validated_data
    # parts_data is None when "parts" key absent from request (don't touch existing parts)
    parts_data = vd.pop("parts", None)
    template = services.update_fault_template(template, vd, parts_data, request.user)
    return Response(FaultTemplateSerializer(template).data)
```

---

## Task 2: Auto-seed `JobSparePartRequest` rows from template parts on job creation

**Files:**
- Modify: `backend/apps/repair/services.py`

- [ ] **Step 1: Extend `create_job()` to seed spare-part requests**

In `backend/apps/repair/services.py`, locate `create_job()`. After the `job = JobTicket.objects.create(...)` call and before the `_write_audit(...)` call, add the seeding block:

```python
    job = JobTicket.objects.create(
        shop=shop,
        customer=customer,
        job_number=job_number,
        template=template,
        created_by=user,
        **data,
    )

    # Auto-seed spare-part requests from the template's default parts list.
    if template:
        for part in template.parts.all():
            JobSparePartRequest.objects.create(
                job=job,
                requested_by=user,
                variant_id=part.variant_id,
                custom_part_name=part.custom_part_name,
                quantity=part.quantity,
            )

    _write_audit(user, AuditLog.Action.CREATE, "JobTicket", job.id, new_value={"job_number": job_number})
```

The `JobSparePartRequest` model has a check constraint requiring either `variant_id` or `custom_part_name` to be present — `FaultTemplatePart` enforces the same constraint at creation time, so this is always safe to copy.

---

## Task 3: Backend tests — nested write + auto-populate

**Files:**
- Create: `backend/apps/repair/tests/test_fault_templates.py`

- [ ] **Step 1: Write the tests**

```python
"""
Tests for FaultTemplate nested-parts write + job auto-populate.
"""

import pytest
from rest_framework import status


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures (mirror those in test_jobs.py — kept here for isolation)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Fix Hub",
        code="FIX",
        address="Ring Road",
        city="Pune",
        state="MH",
        state_code="27",
        phone="+919900000001",
    )


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(shop=shop, name="Test Customer", phone="+919811200002")


@pytest.fixture
def admin_user(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole

    user = User.objects.create_user(
        email="admin@tmpl.test",
        phone="+919000000099",
        full_name="Template Admin",
        password="AdminPass@1",
    )
    role, _ = Role.objects.get_or_create(name="Tenant Admin", defaults={"is_system_role": True})
    for codename in [
        "repair.templates.manage",
        "repair.jobs.create",
        "repair.jobs.view",
    ]:
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"module": "repair", "label": codename}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)
    return user


@pytest.fixture
def admin_client(api_client, admin_user):
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(admin_user)
    access = refresh.access_token
    for k, v in _build_token_claims(admin_user, "test").items():
        access[k] = v
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


TEMPLATE_URL = "/api/v1/repair/fault-templates/"


# ──────────────────────────────────────────────────────────────────────────────
# Nested create
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestFaultTemplateNestedCreate:
    def test_create_template_with_parts_persists_rows(self, admin_client, shop):
        from repair.models import FaultTemplatePart

        payload = {
            "shop_id": str(shop.id),
            "name": "Screen Replacement",
            "device_type": "Smartphone",
            "problem_description": "Customer reports cracked display panel.",
            "default_sc": "1200.00",
            "parts": [
                {"custom_part_name": "OLED Display", "quantity": 1},
                {"custom_part_name": "Adhesive strip", "quantity": 2},
            ],
        }
        res = admin_client.post(TEMPLATE_URL, payload, format="json")

        assert res.status_code == status.HTTP_201_CREATED
        assert len(res.data["parts"]) == 2
        names = {p["custom_part_name"] for p in res.data["parts"]}
        assert names == {"OLED Display", "Adhesive strip"}

        template_id = res.data["id"]
        assert FaultTemplatePart.objects.filter(template_id=template_id).count() == 2

    def test_create_template_without_parts_returns_empty_list(self, admin_client, shop):
        payload = {
            "shop_id": str(shop.id),
            "name": "Quick Clean",
            "device_type": "Laptop",
            "problem_description": "Customer requests routine cleaning of internals.",
            "default_sc": "300.00",
        }
        res = admin_client.post(TEMPLATE_URL, payload, format="json")

        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["parts"] == []

    def test_create_template_part_requires_name_or_variant(self, admin_client, shop):
        payload = {
            "shop_id": str(shop.id),
            "name": "Bad Part Template",
            "device_type": "Laptop",
            "problem_description": "Template with invalid part missing name/variant.",
            "default_sc": "500.00",
            "parts": [
                {"quantity": 1},  # neither variant_id nor custom_part_name
            ],
        }
        res = admin_client.post(TEMPLATE_URL, payload, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ──────────────────────────────────────────────────────────────────────────────
# Nested update (PATCH)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestFaultTemplateNestedUpdate:
    @pytest.fixture
    def template(self, db, shop):
        from repair.models import FaultTemplate, FaultTemplatePart

        t = FaultTemplate.objects.create(
            shop=shop,
            name="Battery Swap",
            device_type="Phone",
            problem_description="Battery not holding charge after one hour of use.",
            default_sc="800.00",
        )
        FaultTemplatePart.objects.create(template=t, custom_part_name="Old Battery", quantity=1)
        return t

    def test_patch_with_parts_replaces_existing(self, admin_client, template):
        from repair.models import FaultTemplatePart

        res = admin_client.patch(
            f"{TEMPLATE_URL}{template.id}/",
            {"parts": [{"custom_part_name": "New Battery", "quantity": 1}]},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["parts"]) == 1
        assert res.data["parts"][0]["custom_part_name"] == "New Battery"
        # Old part gone
        assert not FaultTemplatePart.objects.filter(template=template, custom_part_name="Old Battery").exists()

    def test_patch_without_parts_preserves_existing(self, admin_client, template):
        from repair.models import FaultTemplatePart

        res = admin_client.patch(
            f"{TEMPLATE_URL}{template.id}/",
            {"name": "Battery Replacement"},  # no "parts" key
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        # Old parts still there
        assert FaultTemplatePart.objects.filter(template=template).count() == 1

    def test_patch_with_empty_parts_clears_all(self, admin_client, template):
        from repair.models import FaultTemplatePart

        res = admin_client.patch(
            f"{TEMPLATE_URL}{template.id}/",
            {"parts": []},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["parts"] == []
        assert FaultTemplatePart.objects.filter(template=template).count() == 0


# ──────────────────────────────────────────────────────────────────────────────
# Auto-populate on job create
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestJobAutoPopulateParts:
    @pytest.fixture
    def template_with_parts(self, db, shop):
        from repair.models import FaultTemplate, FaultTemplatePart

        t = FaultTemplate.objects.create(
            shop=shop,
            name="Motherboard Repair",
            device_type="Laptop",
            problem_description="Laptop powers on but keyboard and USB not responding.",
            default_sc="3500.00",
        )
        FaultTemplatePart.objects.create(template=t, custom_part_name="Replacement IC chip", quantity=2)
        FaultTemplatePart.objects.create(template=t, custom_part_name="Thermal paste", quantity=1)
        return t

    def test_create_job_from_template_seeds_spare_parts(
        self, admin_client, shop, customer, template_with_parts
    ):
        from repair.models import JobSparePartRequest

        res = admin_client.post(
            "/api/v1/repair/jobs/",
            {
                "shop_id": str(shop.id),
                "customer_id": str(customer.id),
                "device_type": "Laptop",
                "template_id": str(template_with_parts.id),
                "problem_description": "Laptop powers on but keyboard and USB not responding.",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

        job_id = res.data["id"]
        requests = list(JobSparePartRequest.objects.filter(job_id=job_id).order_by("created_at"))
        assert len(requests) == 2
        names = {r.custom_part_name for r in requests}
        assert names == {"Replacement IC chip", "Thermal paste"}
        qtys = {r.custom_part_name: r.quantity for r in requests}
        assert qtys["Replacement IC chip"] == 2
        assert qtys["Thermal paste"] == 1

    def test_create_job_without_template_has_no_auto_parts(
        self, admin_client, shop, customer
    ):
        from repair.models import JobSparePartRequest

        res = admin_client.post(
            "/api/v1/repair/jobs/",
            {
                "shop_id": str(shop.id),
                "customer_id": str(customer.id),
                "device_type": "Phone",
                "problem_description": "Screen is cracked on the top-left corner.",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

        job_id = res.data["id"]
        assert JobSparePartRequest.objects.filter(job_id=job_id).count() == 0

    def test_create_job_from_template_without_parts_has_no_requests(
        self, admin_client, shop, customer
    ):
        from repair.models import FaultTemplate, JobSparePartRequest

        empty_template = FaultTemplate.objects.create(
            shop=shop,
            name="Generic Repair",
            device_type="Phone",
            problem_description="Generic repair job template for miscellaneous issues.",
            default_sc="500.00",
        )
        res = admin_client.post(
            "/api/v1/repair/jobs/",
            {
                "shop_id": str(shop.id),
                "customer_id": str(customer.id),
                "device_type": "Phone",
                "template_id": str(empty_template.id),
                "problem_description": "Generic repair job template for miscellaneous issues.",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        job_id = res.data["id"]
        assert JobSparePartRequest.objects.filter(job_id=job_id).count() == 0
```

- [ ] **Step 2: Run the tests to verify they fail (confirming the tests are wired correctly before implementation)**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
pytest apps/repair/tests/test_fault_templates.py -v 2>&1 | tail -30
```

Expected: Tests in `TestFaultTemplateNestedCreate` and `TestFaultTemplateNestedUpdate` FAIL (parts field still read-only). `TestJobAutoPopulateParts` FAIL (no auto-seeding yet).

---

## Task 4: Implement the backend changes and verify tests pass

**Files:**
- Modify: `backend/apps/repair/serializers.py`
- Modify: `backend/apps/repair/services.py`
- Modify: `backend/apps/repair/views.py`

- [ ] **Step 1: Apply Task 1 serializer change**

In `backend/apps/repair/serializers.py`, find:

```python
        extra_kwargs = {"parts": {"read_only": True}}
```

Delete that line. The full `FaultTemplateSerializer` should now look like:

```python
class FaultTemplateSerializer(serializers.ModelSerializer):
    shop_id = serializers.PrimaryKeyRelatedField(source="shop", queryset=Shop.objects.all())
    parts = FaultTemplatePartSerializer(many=True, required=False, default=list)

    class Meta:
        model = FaultTemplate
        fields = [
            "id", "shop_id", "name", "device_type", "device_brand",
            "problem_description", "default_sc", "estimated_duration_hours",
            "is_active", "parts", "created_at",
        ]
        read_only_fields = ["id", "created_at"]
```

- [ ] **Step 2: Apply Task 1 service change — add `update_fault_template()`**

In `backend/apps/repair/services.py`, after the closing line of `create_fault_template()` (after line `return template`), insert:

```python
def update_fault_template(
    template: FaultTemplate, data: dict, parts_data: "list | None", user
) -> FaultTemplate:
    """
    Update template fields. When parts_data is not None (i.e. 'parts' key was
    sent in the request), replace all FaultTemplatePart rows atomically.
    parts_data=[] clears parts without adding new ones.
    """
    with transaction.atomic():
        for attr, value in data.items():
            setattr(template, attr, value)
        template.save()
        if parts_data is not None:
            template.parts.all().delete()
            for part in parts_data:
                FaultTemplatePart.objects.create(template=template, **part)
    _write_audit(user, AuditLog.Action.UPDATE, "FaultTemplate", template.id)
    return template
```

- [ ] **Step 3: Apply Task 1 view change — update `partial_update`**

In `backend/apps/repair/views.py`, find the `partial_update` method of `FaultTemplateViewSet` and replace it:

```python
    def partial_update(self, request, pk=None):
        try:
            template = self.get_queryset().get(pk=pk)
        except FaultTemplate.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Fault template not found.")
        serializer = FaultTemplateSerializer(template, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data
        # parts_data is None when "parts" key absent (don't touch existing parts)
        parts_data = vd.pop("parts", None)
        template = services.update_fault_template(template, vd, parts_data, request.user)
        return Response(FaultTemplateSerializer(template).data)
```

- [ ] **Step 4: Apply Task 2 service change — auto-seed spare parts in `create_job()`**

In `backend/apps/repair/services.py`, find `create_job()`. Locate the block:

```python
    job = JobTicket.objects.create(
        shop=shop,
        customer=customer,
        job_number=job_number,
        template=template,
        created_by=user,
        **data,
    )

    _write_audit(user, AuditLog.Action.CREATE, "JobTicket", job.id, new_value={"job_number": job_number})
```

Insert the seeding block between `job = JobTicket.objects.create(...)` and `_write_audit(...)`:

```python
    job = JobTicket.objects.create(
        shop=shop,
        customer=customer,
        job_number=job_number,
        template=template,
        created_by=user,
        **data,
    )

    if template:
        for part in template.parts.all():
            JobSparePartRequest.objects.create(
                job=job,
                requested_by=user,
                variant_id=part.variant_id,
                custom_part_name=part.custom_part_name,
                quantity=part.quantity,
            )

    _write_audit(user, AuditLog.Action.CREATE, "JobTicket", job.id, new_value={"job_number": job_number})
```

- [ ] **Step 5: Run all tests to verify they pass**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
pytest apps/repair/tests/test_fault_templates.py -v 2>&1 | tail -30
```

Expected: all 10 tests PASS.

- [ ] **Step 6: Run full repair test suite to verify no regressions**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
pytest apps/repair/tests/ -v 2>&1 | tail -20
```

Expected: all tests PASS.

---

## Task 5: Frontend — update types and API function signatures

**Files:**
- Modify: `frontend/src/lib/api/repair.ts`

- [ ] **Step 1: Add `FaultTemplatePart` interface and extend `FaultTemplate`**

In `frontend/src/lib/api/repair.ts`, find the `FaultTemplate` interface (currently at line ~117):

```typescript
export interface FaultTemplate {
  id: string;
  shop_id: string;
  name: string;
  device_type: string;
  device_brand?: string | null;
  problem_description: string;
  default_sc: number;
  estimated_duration_hours?: number | null;
  is_active: boolean;
}
```

Replace with:

```typescript
export interface FaultTemplatePart {
  id: string;
  variant_id?: string | null;
  custom_part_name: string;
  quantity: number;
}

export interface FaultTemplate {
  id: string;
  shop_id: string;
  name: string;
  device_type: string;
  device_brand?: string | null;
  problem_description: string;
  default_sc: number;
  estimated_duration_hours?: number | null;
  is_active: boolean;
  parts: FaultTemplatePart[];
}
```

- [ ] **Step 2: Update `createTemplate` to accept `parts`**

Find the `createTemplate` function in `repairApi`:

```typescript
  createTemplate: (body: {
    shop_id: string;
    name: string;
    device_type: string;
    device_brand?: string;
    problem_description: string;
    default_sc: number;
    estimated_duration_hours?: number;
  }) => apiPost<FaultTemplate>('/repair/fault-templates/', body),
```

Replace with:

```typescript
  createTemplate: (body: {
    shop_id: string;
    name: string;
    device_type: string;
    device_brand?: string;
    problem_description: string;
    default_sc: number;
    estimated_duration_hours?: number;
    parts?: Array<{ custom_part_name: string; quantity: number }>;
  }) => apiPost<FaultTemplate>('/repair/fault-templates/', body),
```

- [ ] **Step 3: Update `updateTemplate` to accept `parts`**

Find the `updateTemplate` function:

```typescript
  updateTemplate: (id: string, body: Partial<{
    name: string;
    device_type: string;
    device_brand: string;
    problem_description: string;
    default_sc: number;
    estimated_duration_hours: number;
    is_active: boolean;
  }>) => apiPatch<FaultTemplate>(`/repair/fault-templates/${id}/`, body),
```

Replace with:

```typescript
  updateTemplate: (id: string, body: Partial<{
    name: string;
    device_type: string;
    device_brand: string;
    problem_description: string;
    default_sc: number;
    estimated_duration_hours: number;
    is_active: boolean;
    parts: Array<{ custom_part_name: string; quantity: number }>;
  }>) => apiPatch<FaultTemplate>(`/repair/fault-templates/${id}/`, body),
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep -v "Can\.test\.tsx" | grep "error TS"
```

Expected: no output.

---

## Task 6: Frontend — add parts repeating rows to `TemplateDialog`

**Files:**
- Modify: `frontend/src/app/(app)/settings/fault-templates/page.tsx`

The parts UI uses `useFieldArray` from `react-hook-form` (already installed). Each row has a `custom_part_name` text input + `quantity` number input + remove button. An "Add part" button appends a new blank row. On submit, the parts array is sent to the API.

**Key design decisions:**
- `custom_part_name` is used (not `variant_id`) because inventory cataloguing is not yet integrated for repair templates. This matches the `SparePartRequestSheet` precedent.
- Parts are sent on both create and update. On PATCH, the serializer replaces existing parts with the new list (including when the user clears all rows → sends `parts: []`).
- When `editing` is set, the form is initialized with the template's existing parts.

- [ ] **Step 1: Update the schema and imports**

In `frontend/src/app/(app)/settings/fault-templates/page.tsx`, the current imports include:

```typescript
import { useForm } from 'react-hook-form';
```

Change this line to also import `useFieldArray`:

```typescript
import { useForm, useFieldArray } from 'react-hook-form';
```

Also add `Plus` to the Lucide import (it's already imported in this file — check line 8):
```typescript
import { Plus, Pencil, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
```

- [ ] **Step 2: Replace the `templateSchema` and add `TemplateFormValues` type**

Find:

```typescript
const templateSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  device_type: z.string().min(1, 'Device type is required'),
  device_brand: z.string().optional(),
  problem_description: z.string().min(10, 'At least 10 characters'),
  default_sc: z.number().min(0),
  estimated_duration_hours: z.number().min(0).optional(),
});

type TemplateFormValues = z.infer<typeof templateSchema>;
```

Replace with:

```typescript
const partSchema = z.object({
  custom_part_name: z.string().min(1, 'Part name required'),
  quantity: z.number().int().min(1, 'Min 1'),
});

const templateSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  device_type: z.string().min(1, 'Device type is required'),
  device_brand: z.string().optional(),
  problem_description: z.string().min(10, 'At least 10 characters'),
  default_sc: z.number().min(0),
  estimated_duration_hours: z.number().min(0).optional(),
  parts: z.array(partSchema).default([]),
});

type TemplateFormValues = z.infer<typeof templateSchema>;
```

- [ ] **Step 3: Replace the entire `TemplateDialog` function**

Find the function starting at:

```typescript
function TemplateDialog({
```

Replace the entire function (through its closing `}`) with:

```typescript
function TemplateDialog({
  open, onOpenChange, editing, shopId, onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: FaultTemplate | null;
  shopId: string;
  onSuccess: () => void;
}) {
  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: editing
      ? {
          name: editing.name,
          device_type: editing.device_type,
          device_brand: editing.device_brand ?? '',
          problem_description: editing.problem_description,
          default_sc: editing.default_sc,
          estimated_duration_hours: editing.estimated_duration_hours ?? undefined,
          parts: editing.parts.map((p) => ({ custom_part_name: p.custom_part_name, quantity: p.quantity })),
        }
      : {
          name: '', device_type: '', device_brand: '',
          problem_description: '', default_sc: 0,
          estimated_duration_hours: undefined,
          parts: [],
        },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'parts' });

  // Reset form when editing target changes
  const currentEditId = editing?.id ?? null;
  if (form.getValues('name') !== (editing?.name ?? '') && currentEditId !== null) {
    form.reset({
      name: editing!.name,
      device_type: editing!.device_type,
      device_brand: editing!.device_brand ?? '',
      problem_description: editing!.problem_description,
      default_sc: editing!.default_sc,
      estimated_duration_hours: editing!.estimated_duration_hours ?? undefined,
      parts: editing!.parts.map((p) => ({ custom_part_name: p.custom_part_name, quantity: p.quantity })),
    });
  }

  const saveMutation = useMutation({
    mutationFn: (values: TemplateFormValues) => {
      const parts = values.parts.filter((p) => p.custom_part_name.trim());
      const body = {
        name: values.name,
        device_type: values.device_type,
        device_brand: values.device_brand || undefined,
        problem_description: values.problem_description,
        default_sc: values.default_sc,
        estimated_duration_hours: values.estimated_duration_hours,
        parts,
      };
      return editing
        ? repairApi.updateTemplate(editing.id, body)
        : repairApi.createTemplate({ ...body, shop_id: shopId });
    },
    onSuccess: () => {
      toast.success(editing ? 'Template updated' : 'Template created');
      form.reset();
      onSuccess();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Save failed'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit template' : 'New fault template'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Template name *</FormLabel>
                <FormControl><Input placeholder="iPhone screen replacement" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="device_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Device type *</FormLabel>
                  <FormControl><Input placeholder="Smartphone" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="device_brand" render={({ field }) => (
                <FormItem>
                  <FormLabel>Brand</FormLabel>
                  <FormControl><Input placeholder="Apple" {...field} /></FormControl>
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="problem_description" render={({ field }) => (
              <FormItem>
                <FormLabel>Problem description *</FormLabel>
                <FormControl>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                    placeholder="Customer reports screen cracked after drop…"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="default_sc" render={({ field }) => (
                <FormItem>
                  <FormLabel>Default S/C *</FormLabel>
                  <FormControl>
                    <MoneyInput value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="estimated_duration_hours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Est. hours</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.5}
                      placeholder="2"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                    />
                  </FormControl>
                </FormItem>
              )} />
            </div>

            {/* Default parts */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-body-sm font-medium text-[var(--text)]">Default parts</p>
                <button
                  type="button"
                  onClick={() => append({ custom_part_name: '', quantity: 1 })}
                  className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                >
                  <Plus className="h-3 w-3" /> Add part
                </button>
              </div>
              {fields.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] py-2">
                  No default parts. Click "Add part" to define parts that will be auto-requested on job creation.
                </p>
              ) : (
                <div className="space-y-2">
                  {fields.map((field, index) => (
                    <div key={field.id} className="flex items-start gap-2">
                      <FormField
                        control={form.control}
                        name={`parts.${index}.custom_part_name`}
                        render={({ field: f }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              <Input placeholder="Part name" {...f} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`parts.${index}.quantity`}
                        render={({ field: f }) => (
                          <FormItem className="w-20">
                            <FormControl>
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                placeholder="Qty"
                                value={f.value}
                                onChange={(e) => f.onChange(parseInt(e.target.value, 10) || 1)}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="mt-2 p-1 text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded"
                        aria-label="Remove part"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create template'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep -v "Can\.test\.tsx" | grep "error TS"
```

Expected: no output.

- [ ] **Step 5: Run `next build` to confirm no build errors**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npm run build 2>&1 | tail -15
```

Expected: `✓ Compiled successfully` with no errors.

---

## Task 7: Mark Repair #16 DONE in `docs/ALIGNMENT_AUDIT.md`

**Files:**
- Modify: `docs/ALIGNMENT_AUDIT.md`

- [ ] **Step 1: Find and update the finding**

Find the line containing:

```
| 16 | Med | B | `models.py:FaultTemplatePart` / `serializers.py:FaultTemplateSerializer` | §5.2 | ...
```

Replace the `**DEFERRED**` suffix with:

```
**DONE** — (1) Removed `read_only=True` from `FaultTemplateSerializer.parts`; `FaultTemplatePartSerializer` now accepts `custom_part_name`+`quantity` rows on create and PATCH (PATCH with `parts` key replaces existing rows atomically; PATCH without `parts` key leaves existing rows untouched). (2) `create_job()` service now seeds `JobSparePartRequest` rows from `template.parts.all()` immediately after job creation. (3) `TemplateDialog` gains a `useFieldArray`-backed repeating row UI (part name + qty + remove button + Add Part); parts submitted on both create and update. 10 backend tests added in `test_fault_templates.py`; all existing tests pass.
```

- [ ] **Step 2: Verify**

```bash
grep "16.*DONE\|DONE.*FaultTemplatePart" /home/appuser/workspace/projects/repairOS/docs/ALIGNMENT_AUDIT.md | head -3
```

Expected: the updated line appears with `**DONE**`.

---

## Self-review

**Spec coverage:**
- §3.2 `fault_template_parts` schema — template has `parts[]` with `variant_id | custom_part_name` + `quantity` ✅ (Task 1 serializer, Task 5 UI)
- §4.2 "seeds the parts list from `fault_template_parts`" — `create_job()` seeds `JobSparePartRequest` from template parts ✅ (Task 2 + Task 4 test)
- FE: repeating parts row in `TemplateDialog` ✅ (Task 6)
- Tests: nested write + auto-populate ✅ (Task 3 + Task 4)

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:**
- `FaultTemplatePart` defined in Task 5 step 1; used in `FaultTemplate.parts: FaultTemplatePart[]` ✅
- `parts` in `createTemplate` body is `Array<{ custom_part_name: string; quantity: number }>` — matches what form submits in Task 6 ✅
- `update_fault_template(template, vd, parts_data, user)` signature defined in Task 1 step 2, called in Task 1 step 3 ✅
- `JobSparePartRequest.objects.create(job, requested_by, variant_id, custom_part_name, quantity)` — all fields match model definition ✅
- `template.parts.all()` — works because `FaultTemplatePart.template` has `related_name="parts"` ✅
- `fields.map((field, index) => ...)` — `fields` from `useFieldArray` is typed as `Array<{ id: string; custom_part_name: string; quantity: number }>` ✅
