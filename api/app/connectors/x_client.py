from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any

import httpx

from ..config import get_settings


settings = get_settings()
logger = logging.getLogger(__name__)

TWITTERAPI_BASE = "https://api.twitterapi.io/twitter"
TWITTERAPI_TIMEOUT = 30


@dataclass
class XUser:
    id: str
    username: str
    name: str


async def get_user_by_username(username: str) -> XUser | None:
    if settings.twitterapi_api_key:
        return await _twitterapi_get_user_by_username(username)
    return await _official_get_user_by_username(username)


async def _official_get_user_by_username(username: str) -> XUser | None:
    if not settings.x_bearer_token:
        return None
    url = f"https://api.twitter.com/2/users/by/username/{username}"
    params = {"user.fields": "name,username"}
    headers = {"Authorization": f"Bearer {settings.x_bearer_token}"}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, params=params, headers=headers)
        if r.status_code == 429:
            raise RuntimeError("X API rate limited")
        r.raise_for_status()
        data = r.json()
    u = data.get("data")
    if not u:
        return None
    return XUser(id=str(u["id"]), username=u["username"], name=u.get("name", u["username"]))


async def get_user_tweets(user_id: str, max_results: int = 100) -> list[dict[str, Any]]:
    if settings.twitterapi_api_key:
        return await _twitterapi_get_user_tweets(user_id=user_id, limit=max_results)
    return await _official_get_user_tweets(user_id=user_id, max_results=max_results)


async def _official_get_user_tweets(user_id: str, max_results: int = 100) -> list[dict[str, Any]]:
    if not settings.x_bearer_token:
        return []
    url = f"https://api.twitter.com/2/users/{user_id}/tweets"
    params = {
        "tweet.fields": "created_at,public_metrics",
        "max_results": min(max_results, 100),
        "exclude": "retweets,replies",
    }
    headers = {"Authorization": f"Bearer {settings.x_bearer_token}"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, params=params, headers=headers)
        if r.status_code == 429:
            raise RuntimeError("X API rate limited")
        r.raise_for_status()
        data = r.json()
    return data.get("data", [])


async def _twitterapi_get_user_by_username(username: str) -> XUser | None:
    api_key = settings.twitterapi_api_key
    if not api_key:
        return None
    url = f"{TWITTERAPI_BASE}/user/info"
    params = {"userName": username}
    headers = {"X-API-Key": api_key}
    async with httpx.AsyncClient(timeout=TWITTERAPI_TIMEOUT) as client:
        r = await client.get(url, params=params, headers=headers)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    data = r.json()
    if data.get("status") == "error":
        msg = data.get("msg") or data.get("message", "")
        if msg and "not found" in msg.lower():
            return None
        raise RuntimeError(f"twitterapi.io error: {msg or 'unknown error'}")
    user = data.get("data")
    if not user:
        return None
    return XUser(
        id=str(user.get("id")),
        username=user.get("userName") or username,
        name=user.get("name") or user.get("userName") or username,
    )


async def _twitterapi_get_user_tweets(user_id: str | None = None, *, username: str | None = None, limit: int | None = None) -> list[dict[str, Any]]:
    api_key = settings.twitterapi_api_key
    if not api_key:
        return []
    if not user_id and not username:
        raise ValueError("user_id or username must be provided")

    headers = {"X-API-Key": api_key}
    base_params: dict[str, Any] = {}
    if user_id:
        base_params["userId"] = user_id
    if username and "userId" not in base_params:
        base_params["userName"] = username

    tweets: list[dict[str, Any]] = []
    cursor: str | None = None

    async with httpx.AsyncClient(timeout=TWITTERAPI_TIMEOUT) as client:
        while True:
            params = dict(base_params)
            if cursor:
                params["cursor"] = cursor
            r = await client.get(f"{TWITTERAPI_BASE}/user/last_tweets", params=params, headers=headers)
            if r.status_code == 404:
                break
            r.raise_for_status()
            payload = r.json()
            if payload.get("status") == "error":
                msg = payload.get("message") or payload.get("msg", "")
                if msg and "not found" in msg.lower():
                    break
                raise RuntimeError(f"twitterapi.io error: {msg or 'unknown error'}")

            batch = payload.get("tweets") or []
            if not isinstance(batch, list):
                logger.warning("Unexpected tweets payload shape: %s", type(batch))
                break

            tweets.extend(batch)
            if limit is not None and len(tweets) >= limit:
                tweets = tweets[:limit]
                break

            if not payload.get("has_next_page"):
                break
            cursor = payload.get("next_cursor")
            if not cursor:
                break

    return tweets
