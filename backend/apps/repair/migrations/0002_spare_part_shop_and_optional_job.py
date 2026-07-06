import django.db.models.deletion
from django.db import migrations, models
from django.db.models import OuterRef, Subquery


def backfill_shop_from_job(apps, schema_editor):
    """Existing rows are all job-linked; copy the job's shop onto the new column.

    Done as a single set-based UPDATE (no server-side cursor) so it is safe to run
    through pgbouncer transaction pooling.
    """
    alias = schema_editor.connection.alias
    JobSparePartRequest = apps.get_model("repair", "JobSparePartRequest")
    JobTicket = apps.get_model("repair", "JobTicket")
    JobSparePartRequest.objects.using(alias).filter(shop__isnull=True).update(
        shop=Subquery(
            JobTicket.objects.using(alias).filter(pk=OuterRef("job_id")).values("shop_id")[:1]
        )
    )


def noop_reverse(apps, schema_editor):
    """Reverse is a no-op: the column is dropped by the AddField reversal below.

    Note: reversing this migration is only safe while no job-less rows exist
    (those have job=NULL and would violate the restored NOT NULL on job).
    """
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_add_document_counter"),
        ("repair", "0001_initial"),
    ]

    operations = [
        # 1. Add shop as nullable so existing rows can be backfilled.
        migrations.AddField(
            model_name="jobsparepartrequest",
            name="shop",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="spare_part_requests",
                to="core.shop",
            ),
        ),
        # 2. Backfill shop_id from each row's job.
        migrations.RunPython(backfill_shop_from_job, noop_reverse),
        # 3a. shop becomes required.
        migrations.AlterField(
            model_name="jobsparepartrequest",
            name="shop",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="spare_part_requests",
                to="core.shop",
            ),
        ),
        # 3b. job becomes optional (job-less = stock request).
        migrations.AlterField(
            model_name="jobsparepartrequest",
            name="job",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="spare_part_requests",
                to="repair.jobticket",
            ),
        ),
        # 3c. Index for shop-scoped worklist queries.
        migrations.AddIndex(
            model_name="jobsparepartrequest",
            index=models.Index(
                fields=["shop", "status"], name="job_spare_p_shop_id_b1c1cb_idx"
            ),
        ),
    ]
