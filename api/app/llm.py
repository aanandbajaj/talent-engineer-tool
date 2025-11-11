from __future__ import annotations

# Minimal provider-agnostic interface with a heuristic fallback.
from typing import Iterable

from .utils import top_keywords


class LLMProvider:
    def __init__(self, api_key: str | None = None):
        self.api_key = api_key

    async def extract_topics(self, texts: Iterable[str], k: int = 8) -> list[str]:
        # Heuristic fallback: keyword frequency across titles/abstracts.
        return top_keywords(texts, k=k)

    async def summarize_personality(self, posts: list[str]) -> dict:
        # Simple heuristic personality summary
        if not posts:
            return {"interests": [], "tone": "unknown", "summary": "No social data."}
        interests = top_keywords(posts, k=6)
        return {
            "interests": interests,
            "tone": "mixed",
            "summary": f"Often discusses: {', '.join(interests)}",
        }

