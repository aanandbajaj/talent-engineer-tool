from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from ..config import get_settings
from ..utils import reconstruct_openalex_abstract


settings = get_settings()


@dataclass
class OpenAlexAuthor:
    id: str
    display_name: str
    affiliation: str | None
    works_count: int
    cited_by_count: int


async def search_authors(query: str, limit: int = 10) -> list[OpenAlexAuthor]:
    url = f"{settings.openalex_base}/authors"
    params = {
        "search": query,
        "per_page": limit,
        "sort": "cited_by_count:desc",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        data = r.json()
    authors = []
    for item in data.get("results", []):
        aff = None
        last_inst = item.get("last_known_institution") or {}
        if last_inst:
            aff = last_inst.get("display_name")
        authors.append(
            OpenAlexAuthor(
                id=item["id"],
                display_name=item.get("display_name", "Unknown"),
                affiliation=aff,
                works_count=item.get("works_count", 0),
                cited_by_count=item.get("cited_by_count", 0),
            )
        )
    return authors


async def fetch_top_works(author_id: str, per_page: int = 10) -> list[dict[str, Any]]:
    url = f"{settings.openalex_base}/works"
    # author_id is a full URI like https://openalex.org/A123
    params = {
        "filter": f"author.id:{author_id}",
        "per_page": per_page,
        "sort": "cited_by_count:desc",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        data = r.json()
    works: list[dict[str, Any]] = []
    for w in data.get("results", []):
        abstract_text = None
        inv = w.get("abstract_inverted_index")
        if inv:
            abstract_text = reconstruct_openalex_abstract(inv)
        # infer author's org at publication from authorships
        org_at_pub = None
        for auth in w.get("authorships", []) or []:
            a = (auth.get("author") or {}).get("id")
            if a and a == author_id:
                insts = auth.get("institutions") or []
                if insts:
                    org_at_pub = (insts[0] or {}).get("display_name")
                break
        works.append(
            {
                "title": w.get("title"),
                "venue": (w.get("host_venue") or {}).get("display_name"),
                "year": (w.get("from_year") or w.get("publication_year")),
                "citations": w.get("cited_by_count", 0),
                "abstract": abstract_text,
                "org_at_publication": org_at_pub,
                "work_id": w.get("id"),
            }
        )
    return works
