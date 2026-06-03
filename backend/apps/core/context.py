"""
Tenant context storage — dual WSGI/ASGI safe.

WSGI (sync Django): uses threading.local() — one value per OS thread.
ASGI (Django Channels): uses contextvars.ContextVar — one value per async Task,
safe across awaits without leaking between coroutines.

Both are set simultaneously so the router works regardless of protocol.
"""

import threading
from contextvars import ContextVar, Token
from typing import Optional

_thread_local = threading.local()
_async_tenant_alias: ContextVar[Optional[str]] = ContextVar("tenant_db_alias", default=None)


def set_tenant_db_alias(alias: str) -> Token:
    _thread_local.tenant_db_alias = alias
    return _async_tenant_alias.set(alias)


def get_tenant_db_alias() -> Optional[str]:
    # ContextVar wins for async paths; falls back to thread-local for sync.
    alias = _async_tenant_alias.get(None)
    if alias:
        return alias
    return getattr(_thread_local, "tenant_db_alias", None)


def clear_tenant_context() -> None:
    _thread_local.tenant_db_alias = None
    _async_tenant_alias.set(None)
