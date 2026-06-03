import os
import sys
from pathlib import Path

from celery import Celery

# Put apps/ on the path (same as manage.py)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "apps"))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")

app = Celery("repaiross")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f"Request: {self.request!r}")
