import uuid
import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0004_add_purchase_return_doctype"),
    ]

    operations = [
        migrations.CreateModel(
            name="TenantSettings",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("logo_url", models.CharField(blank=True, max_length=500, null=True)),
                ("invoice_footer", models.TextField(blank=True, default="")),
                ("bank_name", models.CharField(blank=True, max_length=200, null=True)),
                ("bank_account_number", models.CharField(blank=True, max_length=50, null=True)),
                ("bank_ifsc", models.CharField(blank=True, max_length=20, null=True)),
            ],
            options={"db_table": "tenant_settings", "app_label": "core"},
        ),
        migrations.CreateModel(
            name="WhatsAppConnection",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("phone_number", models.CharField(blank=True, max_length=20, null=True)),
                ("is_connected", models.BooleanField(default=False)),
                ("connected_at", models.DateTimeField(null=True, blank=True)),
            ],
            options={"db_table": "whatsapp_connections", "app_label": "core"},
        ),
        migrations.CreateModel(
            name="NotificationTemplate",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("template_name", models.CharField(max_length=100, unique=True)),
                ("is_active", models.BooleanField(default=True)),
                ("custom_body", models.TextField(blank=True, null=True)),
            ],
            options={"db_table": "notification_templates", "app_label": "core"},
        ),
    ]
