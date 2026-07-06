"""
Backfill structured Departments from the legacy free-text Employee.department field.

For each shop, create a Department per distinct non-empty department name and point the
employees' department_ref FK at it. Reverse: detach the FK and delete the rows this
migration created (identified by matching name+shop with employees still carrying the
legacy text).
"""

import re

from django.db import migrations


def _make_code(name: str, used: set) -> str:
    """Derive a <=30-char, per-shop-unique code from a department name."""
    base = re.sub(r"[^A-Za-z0-9]+", "", name).upper()[:30] or "DEPT"
    code = base
    suffix = 1
    while code in used:
        suffix += 1
        tail = str(suffix)
        code = f"{base[: 30 - len(tail)]}{tail}"
    used.add(code)
    return code


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Employee = apps.get_model("hr", "Employee")
    Department = apps.get_model("hr", "Department")

    shop_ids = (
        Employee.objects.using(alias).filter(deleted_at__isnull=True)
        .exclude(department__isnull=True)
        .exclude(department__exact="")
        .values_list("shop_id", flat=True)
        .distinct()
    )
    for shop_id in shop_ids:
        used_codes = set(
            Department.objects.using(alias).filter(shop_id=shop_id).values_list("code", flat=True)
        )
        names = (
            Employee.objects.using(alias).filter(shop_id=shop_id, deleted_at__isnull=True)
            .exclude(department__isnull=True)
            .exclude(department__exact="")
            .values_list("department", flat=True)
            .distinct()
        )
        for name in names:
            dept, created = Department.objects.using(alias).get_or_create(
                shop_id=shop_id, name=name,
                defaults={"code": _make_code(name, used_codes), "is_active": True},
            )
            if not created:
                used_codes.add(dept.code)
            Employee.objects.using(alias).filter(
                shop_id=shop_id, department=name, department_ref__isnull=True
            ).update(department_ref=dept)


def unbackfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Employee = apps.get_model("hr", "Employee")
    Department = apps.get_model("hr", "Department")

    # Detach FKs that still mirror the legacy text, then drop the auto-created rows.
    for dept in Department.objects.using(alias).all().iterator():
        Employee.objects.using(alias).filter(department_ref=dept, department=dept.name).update(
            department_ref=None
        )
    Department.objects.using(alias).filter(employees__isnull=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("hr", "0002_department_employee_department_ref_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill, unbackfill),
    ]
