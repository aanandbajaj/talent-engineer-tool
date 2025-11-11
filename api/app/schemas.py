from __future__ import annotations

from pydantic import BaseModel
from typing import Any, Optional


class SearchRequest(BaseModel):
    query: str
    job_description: Optional[str] = None
    filters: Optional[dict[str, Any]] = None  # e.g., { "seniority": "senior" }


class SearchResponse(BaseModel):
    search_id: str


class CandidateSummary(BaseModel):
    candidate_id: str
    name: str
    affiliation: str | None
    topics: list[str] = []
    score: float
    seniority: str | None = None


class SearchStatusResponse(BaseModel):
    status: str
    progress: int
    results: list[CandidateSummary] | None = None


class CandidateDetail(BaseModel):
    profile: dict
    papers: list[dict]
    social_summary: dict | None = None
    evidence: list[dict] = []
    career: dict | None = None


class CatalogResponse(BaseModel):
    label: str
    candidates: list[CandidateSummary]
