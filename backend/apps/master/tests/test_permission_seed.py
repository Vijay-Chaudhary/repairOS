"""Phase-0 nav blueprint: assert new permission slugs are seeded and granted to Tenant Admin.

The tenant DB router falls back to the default DB when no tenant alias is set
(see core/routers.py), so calling _seed_roles_and_permissions() under the `db`
fixture writes the catalogue into the test database.
"""

import pytest

NEW_SLUGS = [
    # crm
    "crm.deals.view", "crm.deals.create", "crm.deals.edit",
    "crm.deals.change_stage", "crm.deals.close",
    "crm.contacts.view", "crm.contacts.create", "crm.contacts.edit",
    # repair
    "repair.estimates.view",
    # erp
    "erp.products.view", "erp.products.manage", "erp.purchase_returns.view",
    # pos
    "pos.returns.view",
    # billing
    "billing.credit_notes.view", "billing.credit_notes.create", "billing.credit_notes.approve",
    "billing.refunds.view", "billing.refunds.create", "billing.refunds.approve",
    # accounts
    "accounts.income.view", "accounts.income.record", "accounts.cashbook.view",
    "accounts.bank.view", "accounts.bank.manage",
    "accounts.ledger.view", "accounts.ledger.export",
    "accounts.journal.view", "accounts.journal.create", "accounts.journal.post",
    "accounts.chart.manage",
    "accounts.reports.view", "accounts.reports.export",
    # tasks
    "tasks.tasks.view", "tasks.tasks.manage",
    # hr
    "hr.departments.manage",
    # settings
    "settings.taxes.manage", "settings.branches.manage",
    "settings.integrations.manage", "settings.backup.manage", "settings.audit.view",
]


@pytest.mark.django_db
def test_new_slugs_are_seeded_and_granted_to_admin():
    from authentication.models import Permission, Role, RolePermission
    from master.services import _seed_roles_and_permissions

    _seed_roles_and_permissions()

    seeded = set(Permission.objects.values_list("codename", flat=True))
    missing = [s for s in NEW_SLUGS if s not in seeded]
    assert not missing, f"slugs not seeded: {missing}"

    admin = Role.objects.get(name="Tenant Admin")
    admin_slugs = set(
        RolePermission.objects.filter(role=admin).values_list("permission__codename", flat=True)
    )
    not_granted = [s for s in NEW_SLUGS if s not in admin_slugs]
    assert not not_granted, f"slugs not granted to Tenant Admin: {not_granted}"


# Catalogue slugs that used to reach Tenant Admin only, leaving the Products,
# Purchase Returns and Sales Returns pages invisible to every other role.
NON_ADMIN_GRANTS = {
    "Shop Manager": [
        "erp.products.view", "erp.products.manage",
        "erp.purchase_returns.view", "pos.returns.view",
    ],
    "Receptionist": ["erp.products.view", "pos.returns.view"],
    "Technician": ["erp.products.view"],
    "Billing Staff": ["erp.products.view", "pos.returns.view"],
    "Viewer": ["erp.products.view"],
}


@pytest.mark.django_db
@pytest.mark.parametrize("role_name,codenames", sorted(NON_ADMIN_GRANTS.items()))
def test_catalogue_and_return_slugs_reach_non_admin_roles(role_name, codenames):
    from authentication.models import Role, RolePermission
    from master.services import _seed_roles_and_permissions

    _seed_roles_and_permissions()

    role = Role.objects.get(name=role_name)
    granted = set(
        RolePermission.objects.filter(role=role).values_list("permission__codename", flat=True)
    )
    missing = [c for c in codenames if c not in granted]
    assert not missing, f"{role_name} is missing: {missing}"


@pytest.mark.django_db
def test_products_manage_stays_off_read_only_roles():
    from authentication.models import Role, RolePermission
    from master.services import _seed_roles_and_permissions

    _seed_roles_and_permissions()

    for role_name in ("Receptionist", "Technician", "Viewer"):
        role = Role.objects.get(name=role_name)
        granted = set(
            RolePermission.objects.filter(role=role).values_list("permission__codename", flat=True)
        )
        assert "erp.products.manage" not in granted, f"{role_name} must not manage the catalogue"
