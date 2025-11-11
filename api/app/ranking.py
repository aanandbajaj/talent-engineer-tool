from __future__ import annotations

from typing import Iterable

from .utils import normalized_score, top_keywords


def topical_fit(keywords_query: list[str], topics_candidate: list[str]) -> float:
    if not keywords_query or not topics_candidate:
        return 0.0
    s_q = set(k.lower() for k in keywords_query)
    s_c = set(t.lower() for t in topics_candidate)
    inter = len(s_q & s_c)
    return inter / max(1, len(s_q))


def basic_topics_from_publications(pub_texts: Iterable[str], k: int = 8) -> list[str]:
    return top_keywords(pub_texts, k=k)


def score_candidate(
    *,
    query_keywords: list[str],
    topics: list[str],
    h_approx: float,
    best_citations: int,
    recent_year: int | None,
    current_year: int,
    embed_similarity: float = 0.0,
    seniority_fit: float = 1.0,
) -> tuple[float, dict]:
    fit_keywords = topical_fit(query_keywords, topics)
    fit_embed = embed_similarity  # already 0..1
    fit = 0.5 * fit_keywords + 0.5 * fit_embed
    impact = normalized_score(best_citations, 0, 500) * 0.7 + normalized_score(h_approx, 0, 80) * 0.3
    recency = normalized_score((recent_year or (current_year - 15)), current_year - 15, current_year) if recent_year else 0.0

    total = 0.45 * fit + 0.30 * impact + 0.15 * recency + 0.10 * seniority_fit
    breakdown = {
        "fit_keywords": fit_keywords,
        "fit_embed": fit_embed,
        "topical_fit": fit,
        "impact": impact,
        "recency": recency,
        "seniority_fit": seniority_fit,
        "weights": {"fit": 0.45, "impact": 0.30, "recency": 0.15, "seniority": 0.10},
    }
    return total, breakdown


def estimate_seniority(years_active: int | None, h_approx: float, works_count: int) -> str:
    ya = years_active or 0
    if ya >= 10 or h_approx >= 25 or works_count >= 80:
        return "principal"
    if ya >= 6 or h_approx >= 12 or works_count >= 40:
        return "senior"
    if ya >= 3 or h_approx >= 6 or works_count >= 15:
        return "mid"
    return "junior"


def seniority_fit_score(candidate_level: str, desired_level: str | None) -> float:
    if not desired_level:
        return 1.0
    order = ["junior", "mid", "senior", "principal"]
    try:
        ci = order.index(candidate_level)
        di = order.index(desired_level)
    except ValueError:
        return 0.8
    diff = abs(ci - di)
    return [1.0, 0.8, 0.5, 0.2][min(diff, 3)]
