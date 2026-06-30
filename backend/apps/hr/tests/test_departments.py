"""
HR Departments — structured Department model + endpoints (Phase 7).

Covers: permission gating, create/list, per-shop unique code, deactivate,
and assigning a department to an employee via the FK.
"""

import datetime
from decimal import Decimal

import pytest
from rest_framework import status


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures (self-contained — apps/hr/tests has no shared conftest)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Dept Shop", code="DPS",
        address="1 Main", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919000000201",
    )


@pytest.fixture
def client_with_perms(db):
    """Factory: returns an APIClient whose JWT carries the given permission codes."""
    from authentication.models import User
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    def _make(perms):
        user = User.objects.create_user(
            email=f"u{User.objects.count()}@test.com",
            phone=f"+9190000003{User.objects.count():02d}",
            full_name="Dept User", password="pass",
        )
        access = RefreshToken.for_user(user).access_token
        access["permissions"] = list(perms)
        access["is_tenant_wide"] = True
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        return client

    return _make


@pytest.fixture
def employee(db, shop):
    from hr.models import Employee
    emp = Employee(
        shop=shop,
        employee_code="EMP100",
        full_name="Dana Tech",
        designation="Technician",
        date_of_joining=datetime.date(2025, 1, 1),
        basic_salary=Decimal("20000.00"),
        gross_salary=Decimal("20000.00"),
    )
    emp.save()
    return emp


URL = "/api/v1/hr/departments/"


# ──────────────────────────────────────────────────────────────────────────────
# Tests
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_create_department_requires_manage_perm(client_with_perms, shop):
    client = client_with_perms(["hr.employees.view"])  # read-only, no manage
    resp = client.post(URL, {"shop_id": str(shop.id), "name": "Service", "code": "SVC"}, format="json")
    assert resp.status_code == status.HTTP_403_FORBIDDEN, resp.content


@pytest.mark.django_db
def test_create_and_list_department(client_with_perms, shop):
    client = client_with_perms(["hr.departments.manage", "hr.employees.view"])
    resp = client.post(URL, {"shop_id": str(shop.id), "name": "Service", "code": "SVC"}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    assert resp.json()["data"]["code"] == "SVC"

    listed = client.get(URL)
    assert listed.status_code == status.HTTP_200_OK, listed.content
    codes = [d["code"] for d in listed.json()["data"]["items"]]
    assert "SVC" in codes


@pytest.mark.django_db
def test_department_code_unique_per_shop(client_with_perms, shop):
    client = client_with_perms(["hr.departments.manage", "hr.employees.view"])
    first = client.post(URL, {"shop_id": str(shop.id), "name": "Service", "code": "SVC"}, format="json")
    assert first.status_code == status.HTTP_201_CREATED, first.content

    dup = client.post(URL, {"shop_id": str(shop.id), "name": "Service 2", "code": "SVC"}, format="json")
    assert dup.status_code == status.HTTP_400_BAD_REQUEST, dup.content


@pytest.mark.django_db
def test_deactivate_department(client_with_perms, shop):
    client = client_with_perms(["hr.departments.manage", "hr.employees.view"])
    created = client.post(URL, {"shop_id": str(shop.id), "name": "Sales", "code": "SAL"}, format="json")
    dept_id = created.json()["data"]["id"]

    resp = client.patch(f"{URL}{dept_id}/", {"is_active": False}, format="json")
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["data"]["is_active"] is False


@pytest.mark.django_db
def test_employee_assign_department_fk(client_with_perms, shop):
    from hr.models import Employee

    client = client_with_perms(
        ["hr.departments.manage", "hr.employees.view", "hr.employees.manage"]
    )
    created = client.post(URL, {"shop_id": str(shop.id), "name": "Service", "code": "SVC"}, format="json")
    dept_id = created.json()["data"]["id"]

    resp = client.post("/api/v1/hr/employees/", {
        "shop_id": str(shop.id),
        "employee_code": "EMP200",
        "full_name": "Eve Tech",
        "designation": "Technician",
        "date_of_joining": "2026-01-01",
        "basic_salary": "10000",
        "gross_salary": "10000",
        "department_id": dept_id,
    }, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content

    emp = Employee.objects.get(employee_code="EMP200")
    assert str(emp.department_ref_id) == dept_id
