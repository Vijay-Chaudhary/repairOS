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
    # billing
    "billing.credit_notes.view", "billing.credit_notes.create", "billing.credit_notes.approve",
    "billing.refunds.view", "billing.refunds.create", "billing.refunds.approve",
    # accounts
    "accounts.income.view", "accounts.income.record", "accounts.cashbook.view",
    "accounts.bank.view", "accounts.bank.manage",
    "accounts.ledger.view", "accounts.ledger.export",
    "accounts.journal.view", "accounts.journal.create", "accounts.journal.post",
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
