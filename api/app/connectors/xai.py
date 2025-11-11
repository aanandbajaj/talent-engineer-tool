from __future__ import annotations

from typing import Any, List

import httpx

from ..config import get_settings


settings = get_settings()


async def grok_chat(messages: List[dict[str, str]], model: str | None = None) -> str:
    """Call xAI Grok chat API. Falls back to a stub if no key configured.

    messages: list of {role: 'system'|'user'|'assistant', content: str}
    """
    if not settings.xai_api_key:
        # Fallback stub for local development
        last = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        return f"[stub grok] You asked: {last[:200]}... (no xAI key configured)"

    url = "https://api.x.ai/v1/chat/completions"
    payload: dict[str, Any] = {
        "model": model or settings.grok_model,
        "messages": messages,
        "temperature": 0.2,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {settings.xai_api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()
    # Expected shape similar to OpenAI; adjust if xAI differs
    try:
        return data["choices"][0]["message"]["content"]
    except Exception:
        return str(data)

