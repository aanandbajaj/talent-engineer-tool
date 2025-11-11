from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, Dict

import httpx

from .config import get_settings


# Ensure .env values are loaded
get_settings()


class SupabaseUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _get_supabase_config() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    if not url or not key:
        raise SupabaseUnavailable("Supabase client not configured; set SUPABASE_URL and a key.")
    return url.rstrip("/"), key


def supabase_select(table: str, *, select: str, filters: Dict[str, str] | None = None, limit: int | None = None, order: str | None = None) -> list[dict[str, Any]]:
    base, key = _get_supabase_config()
    params: Dict[str, Any] = {"select": select}
    if filters:
        params.update(filters)
    if limit is not None:
        params["limit"] = max(1, int(limit))
    if order:
        params["order"] = order
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    with httpx.Client(timeout=20) as client:
        resp = client.get(f"{base}/rest/v1/{table}", params=params, headers=headers)
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, list):
        return data
    return [data]
