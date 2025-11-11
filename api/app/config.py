from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


def _load_env() -> None:
    base_path = Path(__file__).resolve()
    candidates = [
        base_path.parents[1] / ".env",  # api/.env
        base_path.parents[2] / ".env",  # repo root .env
    ]
    for path in candidates:
        if path.exists():
            load_dotenv(dotenv_path=path, override=False)
    # As a fallback, load default .env in current working dir
    load_dotenv(override=False)


_load_env()


@dataclass
class Settings:
    # Base
    app_name: str = "x-ai-talent-engineer-api"
    debug: bool = os.getenv("DEBUG", "false").lower() == "true"

    # CORS/frontends
    # Use default_factory to avoid mutable default list errors on Python 3.12+
    cors_origins: list[str] = field(
        default_factory=lambda: os.getenv(
            "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
    )

    # Database
    db_url: str = os.getenv("DATABASE_URL", "sqlite:///./dev.db")

    # External APIs
    openalex_base: str = os.getenv("OPENALEX_BASE", "https://api.openalex.org")

    # LLM (optional – stubbed if not set)
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")

    # X (Twitter) API
    x_bearer_token: str | None = os.getenv("X_BEARER_TOKEN")
    twitterapi_api_key: str | None = os.getenv("TWITTERAPI_API_KEY")

    # xAI Grok API
    xai_api_key: str | None = os.getenv("XAI_API_KEY")
    grok_model: str = os.getenv("GROK_MODEL", "grok-2-latest")

    # OpenRouter (for Grok via OpenRouter)
    openrouter_api_key: str | None = os.getenv("OPENROUTER_API_KEY")
    openrouter_model: str = os.getenv("OPENROUTER_MODEL", "x-ai/grok-4-fast")

    # Embeddings
    embed_dim: int = int(os.getenv("EMBED_DIM", "512"))


def get_settings() -> Settings:
    return Settings()
