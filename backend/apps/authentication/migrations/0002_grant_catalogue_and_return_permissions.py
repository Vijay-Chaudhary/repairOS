"""
Backfill role grants that the Phase-0 permission catalogue never handed out.

`erp.products.view`, `erp.products.manage` and `erp.purchase_returns.view` were
added to the catalogue in master.services._seed_roles_and_permissions() but were
never listed under any role, so only Tenant Admin (which is granted every
permission programmatically) could see the Products and Purchase Returns pages.
`pos.returns.view` is new here — it gates the sales-returns list.

Runs on tenant DBs only: the router keeps the authentication app off the master
DB (core.routers.MASTER_ONLY_APP_LABELS).
"""

from django.db import migrations

# Permissions this migration may have to create before granting them.
NEW_PERMISSIONS = [
    ("pos.returns.view", "pos", "Pos Returns View"),
]

# role name → permission codenames to grant
GRANTS: dict[str, list[str]] = {
    "Shop Manager": [
        "erp.products.view",
        "erp.products.manage",
        "erp.purchase_returns.view",
        "pos.returns.view",
    ],
    "Receptionist": [
        "erp.products.view",
        "pos.returns.view",
    ],
    "Technician": [
        "erp.products.view",
    ],
    "Billing Staff": [
        "erp.products.view",
        "pos.returns.view",
    ],
    "Viewer": [
        "erp.products.view",
    ],
    # Tenant Admin holds every permission — handled below so the new
    # pos.returns.view row reaches already-provisioned tenants too.
}


def grant(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    Role = apps.get_model("authentication", "Role")
    RolePermission = apps.get_model("authentication", "RolePermission")
    db = schema_editor.connection.alias

    for codename, module, label in NEW_PERMISSIONS:
        Permission.objects.using(db).get_or_create(
            codename=codename,
            defaults={"module": module, "label": label},
        )

    perms = {p.codename: p for p in Permission.objects.using(db).all()}
    roles = {r.name: r for r in Role.objects.using(db).all()}

    rows = []
    for role_name, codenames in GRANTS.items():
        role = roles.get(role_name)
        if role is None:  # tenant renamed or dropped the stock role
            continue
        for codename in codenames:
            perm = perms.get(codename)
            if perm is not None:
                rows.append(RolePermission(role=role, permission=perm))

    admin_role = roles.get("Tenant Admin")
    if admin_role is not None:
        rows.extend(
            RolePermission(role=admin_role, permission=perms[codename])
            for codename, _module, _label in NEW_PERMISSIONS
            if codename in perms
        )

    if rows:
        RolePermission.objects.using(db).bulk_create(rows, ignore_conflicts=True)


def revoke(apps, schema_editor):
    Permission = apps.get_model("authentication", "Permission")
    Role = apps.get_model("authentication", "Role")
    RolePermission = apps.get_model("authentication", "RolePermission")
    db = schema_editor.connection.alias

    for role_name, codenames in GRANTS.items():
        role = Role.objects.using(db).filter(name=role_name).first()
        if role is None:
            continue
        RolePermission.objects.using(db).filter(
            role=role, permission__codename__in=codenames
        ).delete()

    # Drop the permission this migration introduced (cascades its Tenant Admin grant).
    Permission.objects.using(db).filter(
        codename__in=[c for c, _m, _l in NEW_PERMISSIONS]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(grant, revoke),
    ]
