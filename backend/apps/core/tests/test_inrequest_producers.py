import uuid
from decimal import Decimal

import pytest


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")


def _user(email):
    from authentication.models import User
    return User.objects.create_user(email=email, phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
                                    full_name="U", password="p")


@pytest.mark.django_db
def test_job_status_change_notifies_tech_and_creator_not_actor(shop):
    from repair.models import JobStage, JobTicket
    from repair.services import transition_job
    from core.models import Notification
    from crm.models import Customer

    tech = _user("tech@t.com")
    creator = _user("creator@t.com")
    actor = _user("actor@t.com")
    cust = Customer.objects.create(shop=shop, name="C", phone="+919811111111")
    job = JobTicket.objects.create(
        shop=shop, customer=cust, created_by=creator,
        job_number="HTA-1", device_type="Laptop", device_brand="Dell", device_model="X",
        problem_description="p", service_charge=Decimal("100"),
        status=JobTicket.Status.OPEN,
    )
    # Technicians are assigned per-stage, not on the job.
    JobStage.objects.create(
        job=job, stage_order=1, stage_type=JobStage.StageType.REPAIR, assigned_technician=tech,
    )
    transition_job(job, JobTicket.Status.IN_PROGRESS, actor)

    recipients = set(Notification.objects.filter(type="job_status").values_list("recipient_id", flat=True))
    assert tech.id in recipients
    assert creator.id in recipients
    assert actor.id not in recipients
