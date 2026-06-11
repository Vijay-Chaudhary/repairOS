import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60, name="master.provision_tenant")
def provision_tenant(self, tenant_id: str) -> None:
    """
    Async task: provision a new tenant's database, run migrations, seed roles,
    and create the Tenant Admin user.  Retries up to 3 times (60-second delay)
    before marking the tenant as provisioning_failed.
    """
    from . import services

    try:
        services.do_provision_tenant(tenant_id)
    except Exception as exc:
        logger.exception("Provisioning attempt %d failed for tenant %s.", self.request.retries + 1, tenant_id)
        try:
            raise self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            services.mark_provisioning_failed(tenant_id)
            raise
