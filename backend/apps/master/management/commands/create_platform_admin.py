"""
Management command to create a platform admin account (master DB only).

Usage:
    python manage.py create_platform_admin --email platform@repaiross.app \
        --full-name "Platform Admin" --password "Demo@1234!"
"""
from django.core.management.base import BaseCommand, CommandError

from master.models import PlatformAdminUser


class Command(BaseCommand):
    help = "Create a platform admin account in the master DB."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--full-name", required=True)
        parser.add_argument("--password", required=True)

    def handle(self, *args, **options):
        email = options["email"].lower()
        full_name = options["full_name"]
        password = options["password"]

        if PlatformAdminUser.objects.using("default").filter(email=email).exists():
            raise CommandError(f"Platform admin '{email}' already exists.")

        admin = PlatformAdminUser(email=email, full_name=full_name)
        admin.set_password(password)
        admin.save(using="default")

        self.stdout.write(self.style.SUCCESS(f"Platform admin '{email}' created."))
