import uuid
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0005_tenant_settings_whatsapp_notification_template"),
    ]

    operations = [
        migrations.CreateModel(
            name="NotificationLog",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("customer_id", models.UUIDField(blank=True, db_index=True, null=True)),
                ("lead_id", models.UUIDField(blank=True, db_index=True, null=True)),
                ("template_name", models.CharField(db_index=True, max_length=100)),
                ("channel", models.CharField(
                    choices=[("whatsapp", "WhatsApp"), ("email", "Email"), ("sms", "SMS")],
                    default="whatsapp",
                    max_length=10,
                )),
                ("recipient_phone", models.CharField(blank=True, default="", max_length=20)),
                ("recipient_email", models.EmailField(blank=True, default="")),
                ("status", models.CharField(
                    choices=[
                        ("queued", "Queued"),
                        ("sent", "Sent"),
                        ("delivered", "Delivered"),
                        ("read", "Read"),
                        ("failed", "Failed"),
                    ],
                    default="queued",
                    max_length=20,
                )),
                ("whatsapp_message_id", models.CharField(blank=True, default="", max_length=100)),
                ("attempt_count", models.IntegerField(default=0)),
                ("last_attempt_at", models.DateTimeField(blank=True, null=True)),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
                ("delivered_at", models.DateTimeField(blank=True, null=True)),
                ("failed_reason", models.TextField(blank=True, default="")),
            ],
            options={"app_label": "core", "db_table": "notification_logs"},
        ),
        migrations.AddIndex(
            model_name="notificationlog",
            index=models.Index(fields=["template_name", "status"], name="notif_log_tmpl_status_idx"),
        ),
        migrations.AddIndex(
            model_name="notificationlog",
            index=models.Index(fields=["created_at"], name="notif_log_created_at_idx"),
        ),
    ]
