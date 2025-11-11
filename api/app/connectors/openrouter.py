from __future__ import annotations

from typing import Any, List, Optional

import json
import uuid

import httpx

from ..config import get_settings


settings = get_settings()


async def chat(messages: List[dict[str, Any]], *, model: Optional[str] = None, tools: Optional[list] = None, tool_choice: Optional[str] = None) -> str:
    """Call OpenRouter Responses API (Beta) and return the assistant text."""
    if not settings.openrouter_api_key:
        last = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
        return f"[stub openrouter] You asked: {last[:200]}... (no OPENROUTER_API_KEY configured)"

    data = await _responses_request(messages, model=model, tools=tools, tool_choice=tool_choice)
    text = _extract_first_text(data)
    if text:
        return text
    return json.dumps(data)


async def chat_raw(messages: List[dict[str, Any]], *, model: Optional[str] = None, tools: Optional[list] = None, tool_choice: Optional[str] = None) -> dict:
    """Return an OpenAI-chat-compatible wrapper around the Responses API output."""
    if not settings.openrouter_api_key:
        return {
            "choices": [
                {"message": {"role": "assistant", "content": "[stub openrouter raw response]", "tool_calls": []}}
            ]
        }

    data = await _responses_request(messages, model=model, tools=tools, tool_choice=tool_choice)
    text = _extract_first_text(data)
    tool_calls = _extract_tool_calls(data)
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": text,
                    "tool_calls": tool_calls,
                }
            }
        ],
        "response": data,
    }


def _convert_messages(messages: List[dict[str, Any]]) -> List[dict[str, Any]]:
    converted: List[dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role", "user")
        if role == "tool":
            call_id = msg.get("tool_call_id") or f"call_{uuid.uuid4().hex}"
            converted.append(
                {
                    "type": "function_call_output",
                    "id": f"fc_output_{uuid.uuid4().hex}",
                    "call_id": call_id,
                    "output": msg.get("content") or "",
                }
            )
            continue

        content = msg.get("content")
        if isinstance(content, list):
            parts = content
        else:
            text = str(content or "")
            part_type = "output_text" if role == "assistant" else "input_text"
            parts = [{"type": part_type, "text": text}]

        entry: dict[str, Any] = {
            "type": "message",
            "role": role,
            "content": parts,
        }
        if "name" in msg:
            entry["name"] = msg["name"]
        converted.append(entry)
    return converted


async def _responses_request(messages: List[dict[str, Any]], *, model: Optional[str], tools: Optional[list], tool_choice: Optional[str]) -> dict:
    payload: dict[str, Any] = {
        "model": model or settings.openrouter_model,
        "input": _convert_messages(messages),
        "temperature": 0.2,
    }
    if tools:
        payload["tools"] = tools
    if tool_choice is not None:
        payload["tool_choice"] = tool_choice

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost",
        "X-Title": settings.app_name,
    }
    url = "https://openrouter.ai/api/v1/responses"
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, headers=headers, json=payload)
        r.raise_for_status()
        return r.json()


def _extract_first_text(response: dict[str, Any]) -> str:
    outputs = response.get("output") or []
    texts: list[str] = []
    for item in outputs:
        if item.get("type") != "message":
            continue
        for part in item.get("content", []) or []:
            if part.get("type") in {"output_text", "input_text"}:
                txt = part.get("text")
                if txt:
                    texts.append(txt)
    return "\n\n".join(texts).strip()


def _extract_tool_calls(response: dict[str, Any]) -> list[dict[str, Any]]:
    tool_calls: list[dict[str, Any]] = []
    for item in response.get("output") or []:
        if item.get("type") != "function_call":
            continue
        arguments = item.get("arguments")
        if isinstance(arguments, (dict, list)):
            arguments_str = json.dumps(arguments, ensure_ascii=False)
        else:
            arguments_str = arguments or "{}"
        call = {
            "id": item.get("id") or item.get("call_id") or f"call_{uuid.uuid4().hex}",
            "type": "function",
            "function": {
                "name": item.get("name"),
                "arguments": arguments_str,
            },
        }
        tool_calls.append(call)
    return tool_calls
