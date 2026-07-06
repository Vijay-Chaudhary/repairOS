"""Autodiscovered seeder registry with dependency-ordered iteration."""
import importlib

from django.apps import apps as django_apps
from django.core.exceptions import ImproperlyConfigured

from .base import Seeder

_registry: dict[str, Seeder] = {}


def register(cls: type[Seeder]) -> type[Seeder]:
    """Class decorator/registrar. Seeders register an instance under their name."""
    instance = cls()
    if not instance.name:
        raise ImproperlyConfigured(f"{cls.__name__} needs a non-empty `name`.")
    if instance.name in _registry:
        raise ImproperlyConfigured(f"Duplicate seeder name: {instance.name}")
    _registry[instance.name] = instance
    return cls


def autodiscover() -> None:
    """Import <app>.seeds for every installed app (Celery tasks.py pattern)."""
    for app_config in django_apps.get_app_configs():
        module = f"{app_config.name}.seeds"
        try:
            importlib.import_module(module)
        except ModuleNotFoundError as exc:
            if exc.name != module:
                raise  # seeds.py exists but has a broken import — surface it


def ordered(scope: str | None = None) -> list[Seeder]:
    """All seeders in dependency order (Kahn), optionally filtered by scope.

    The graph is validated over ALL registered seeders (so a demo seeder may
    depend on a reference seeder); the scope filter applies to the result.
    """
    for seeder in _registry.values():
        for dep in seeder.depends_on:
            if dep not in _registry:
                raise ImproperlyConfigured(
                    f"Seeder '{seeder.name}' depends on unknown seeder '{dep}'."
                )

    in_degree = {name: len(s.depends_on) for name, s in _registry.items()}
    dependents: dict[str, list[str]] = {name: [] for name in _registry}
    for name, seeder in _registry.items():
        for dep in seeder.depends_on:
            dependents[dep].append(name)

    queue = sorted(name for name, deg in in_degree.items() if deg == 0)
    result: list[Seeder] = []
    while queue:
        name = queue.pop(0)
        result.append(_registry[name])
        for child in sorted(dependents[name]):
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

    if len(result) != len(_registry):
        cyclic = sorted(set(_registry) - {s.name for s in result})
        raise ImproperlyConfigured(f"Seeder dependency cycle involving: {cyclic}")

    if scope is not None:
        result = [s for s in result if s.scope == scope]
    return result
