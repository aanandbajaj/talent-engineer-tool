from __future__ import annotations

import asyncio
import json
import re
import uuid
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, AsyncGenerator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import text as sql_text

from .config import get_settings
from .db import init_db, get_session
from .models import Job, JobStatus, Candidate, AnalysisSummary, Publication, AffiliationYear, SocialPost, Embedding
from .schemas import (
    SearchRequest,
    SearchResponse,
    SearchStatusResponse,
    CandidateSummary,
    CandidateDetail,
    CatalogResponse,
)
from .orchestrator import run_search, events
from .supabase_repo import (
    get_user_id_by_username,
    get_recent_tweets_by_user_id,
    get_corpus_doc_by_username,
    get_linkedin_profile,
    get_researcher_profile_by_name,
    get_user_corpus_by_name,
    get_user_corpus_by_username,
    list_researchers,
    get_linkedin_profile_row,
    get_researcher_by_id,
    get_all_relationships,
    get_relationships_by_username,
    get_user_profile_info,
    get_batch_user_profiles,
)
from .compensation import estimate_compensation
from .embeddings import SimpleEmbedder
from .rag import query_tweets
from .connectors import openrouter as openrouter_client
from .connectors import x_client
from .connectors import xai as xai_client
from .supabase_client import SupabaseUnavailable


settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0")


CATALOG_CONFIG: dict[str, dict[str, str]] = {
    "ai_researchers": {"label": "AI Researchers"},
}


def _coerce_created_datetime(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    text = value.strip()
    try:
        candidate = text
        if candidate.endswith("Z") and "+" not in candidate[-6:]:
            candidate = candidate[:-1] + "+00:00"
        dt = datetime.fromisoformat(candidate)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        try:
            dt = parsedate_to_datetime(text)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            return datetime.now(timezone.utc)


def _normalize_tweet_payload(tweet: dict[str, Any]) -> tuple[str, str, int, int, str]:
    pm = tweet.get("public_metrics") or {}
    like = int(pm.get("like_count", tweet.get("likeCount", 0)) or 0)
    repost = int(pm.get("retweet_count", tweet.get("retweetCount", tweet.get("repostCount", 0))) or 0)
    created_raw = tweet.get("created_at") or tweet.get("createdAt")
    created_dt = _coerce_created_datetime(created_raw)
    created = created_dt.isoformat().replace("+00:00", "Z")
    post_id = str(tweet.get("id") or tweet.get("tweet_id") or tweet.get("url") or uuid.uuid4())
    text = tweet.get("text", "")
    return post_id, text, like, repost, created

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:  # create tables
    init_db()


@app.post("/search", response_model=SearchResponse)
async def post_search(payload: SearchRequest) -> SearchResponse:
    with get_session() as s:
        job = Job(
            query=payload.query,
            job_description=payload.job_description,
            filters_json=json.dumps(payload.filters or {}),
            status=JobStatus.PENDING,
            progress=0,
        )
        s.add(job)
        s.commit()
        s.refresh(job)

    # Kick off background processing
    asyncio.create_task(run_search(job.id))
    return SearchResponse(search_id=job.id)


@app.get("/search/{search_id}", response_model=SearchStatusResponse)
async def get_search(search_id: str) -> SearchStatusResponse:
    with get_session() as s:
        job = s.get(Job, search_id)
        if not job:
            raise HTTPException(status_code=404, detail="search not found")

        # collect current candidates
        results: list[CandidateSummary] = []
        if job.status in {JobStatus.RUNNING, JobStatus.DONE}:
            # Get latest analysis for candidates, order by score desc
            candidates = s.exec(
                sql_text(
                    """
                    SELECT candidate.id, candidate.name, candidate.affiliation,
                           analysis_summary.topics_json, analysis_summary.total_score
                    FROM analysis_summary
                    JOIN candidate ON candidate.id = analysis_summary.candidate_id
                    ORDER BY analysis_summary.total_score DESC
                    LIMIT 20
                    """
                )
            ).all()
            for cid, name, aff, topics_json, score in candidates:
                try:
                    topics = json.loads(topics_json or "[]")
                except Exception:
                    topics = []
                # try parse seniority from last breakdown of this candidate
                lvl = None
                br = s.exec(
                    sql_text(
                        """
                        SELECT score_breakdown_json FROM analysis_summary
                        WHERE candidate_id = :cid
                        ORDER BY total_score DESC LIMIT 1
                        """
                    ).params(cid=cid)
                ).first()
                if br and br[0]:
                    try:
                        lvl = json.loads(br[0]).get("seniority")
                    except Exception:
                        lvl = None
                results.append(CandidateSummary(candidate_id=cid, name=name, affiliation=aff, topics=topics, score=score, seniority=lvl))

        return SearchStatusResponse(status=job.status, progress=job.progress, results=results)


@app.get("/catalog", response_model=CatalogResponse)
async def get_catalog(key: str, limit: int = 1000) -> CatalogResponse:
    cfg = CATALOG_CONFIG.get(key)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"unknown catalog key '{key}'")
    lim = max(1, min(2000, int(limit or 0) or 1000))
    try:
        rows = list_researchers(limit=lim)
    except SupabaseUnavailable:
        rows = []
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail="Failed to load catalog") from exc

    seen: set[str] = set()
    candidates: list[CandidateSummary] = []
    for idx, row in enumerate(rows):
        handle = _normalize_handle(row.get("handle"))
        dedupe_key = handle or str(row.get("id") or row.get("name") or f"{key}-{idx}")
        key_lower = dedupe_key.lower()
        if key_lower in seen:
            continue
        seen.add(key_lower)
        display_name = row.get("name") or (f"@{handle}" if handle else "Unknown researcher")
        affiliation = row.get("organization") or row.get("country")
        candidate_id = str(row.get("id") or f"catalog:{key}:{idx}")
        candidates.append(
            CandidateSummary(
                candidate_id=candidate_id,
                name=display_name,
                affiliation=affiliation,
                topics=[],
                score=0.1,
                seniority=None,
            )
        )

    return CatalogResponse(label=cfg["label"], candidates=candidates)


@app.get("/events/{search_id}")
async def sse_events(search_id: str) -> StreamingResponse:
    async def event_stream() -> AsyncGenerator[bytes, None]:
        queue = events.get_queue(search_id)
        # Send a hello event so client is connected
        yield b"event: ping\n\n"
        while True:
            try:
                data = await asyncio.wait_for(queue.get(), timeout=60)
                yield f"data: {data}\n\n".encode("utf-8")
            except asyncio.TimeoutError:
                # keep-alive
                yield b"event: ping\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/linkedin/{username}")
async def get_linkedin(username: str) -> dict:
    uname = username.lstrip("@")
    try:
        row = get_linkedin_profile_row(uname)
    except SupabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail="Supabase not configured for LinkedIn data") from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail="Failed to load LinkedIn profile") from exc
    if not row:
        raise HTTPException(status_code=404, detail="LinkedIn profile not found")
    profile = _linkedin_profile_from_row(row)
    return {
        "username": row.get("username") or uname,
        "name": row.get("name"),
        "profile": profile,
    }


def _format_openalex_url(raw_id: str | None) -> str | None:
    if not raw_id:
        return None
    rid = raw_id.strip()
    if not rid:
        return None
    rid = rid.replace("https://api.openalex.org/", "https://openalex.org/")
    if rid.startswith("http://"):
        rid = "https://" + rid[len("http://"):]
    if rid.startswith("https://"):
        return rid
    if rid.startswith("openalex.org/"):
        return f"https://{rid}"
    if rid[0] in {"W", "A", "S"}:
        return f"https://openalex.org/{rid}"
    return None


def _normalize_handle(handle: str | None) -> str | None:
    if not handle:
        return None
    if not isinstance(handle, str):
        handle = str(handle)
    stripped = handle.strip()
    if not stripped:
        return None
    return stripped.lstrip("@") or None


_YEAR_PATTERN = re.compile(r"(19|20)\d{2}")


def _coerce_year(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        year = int(value)
        if 1900 <= year <= 2100:
            return year
        return None
    if isinstance(value, str):
        match = _YEAR_PATTERN.search(value)
        if match:
            return int(match.group())
    return None


def _coerce_salary(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace(",", "")
        match = re.search(r"\d+(?:\.\d+)?", cleaned)
        if match:
            try:
                return float(match.group())
            except ValueError:
                return None
    if isinstance(value, dict):
        for key in ("usd", "amount_usd", "amountUSD", "value", "amount"):
            if key in value:
                return _coerce_salary(value[key])
    return None


def _maybe_parse_json(value: Any) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                return json.loads(stripped)
            except Exception:
                return value
    return value


def _normalize_career_entries(raw: Any) -> list[dict[str, Any]]:
    raw = _maybe_parse_json(raw)
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    if isinstance(raw, dict):
        for key in ("positions", "history", "items", "entries", "data"):
            val = raw.get(key)
            if isinstance(val, list):
                return [item for item in val if isinstance(item, dict)]
        return [raw]
    return []


def _samples_from_salary_blob(blob: Any, basis: str) -> list[dict[str, Any]]:
    items: list[Any] = []
    blob = _maybe_parse_json(blob)
    if isinstance(blob, list):
        items = blob
    elif isinstance(blob, dict):
        for key in ("items", "entries", "data"):
            val = blob.get(key)
            if isinstance(val, list):
                items = val
                break
    samples: list[dict[str, Any]] = []
    for entry in items:
        if not isinstance(entry, dict):
            continue
        year = _coerce_year(entry.get("year") or entry.get("year_num"))
        if not year:
            continue
        org = entry.get("org") or entry.get("organization") or entry.get("company")
        salary = None
        for key in ("salary_usd", "salaryUSD", "salary", "compensation_usd", "compensation", "total_compensation_usd", "totalCompUSD", "value"):
            if key in entry:
                salary = _coerce_salary(entry[key])
                if salary is not None:
                    break
        samples.append({
            "year": year,
            "org": org,
            "salary_usd": salary or 0,
            "band": entry.get("band") or entry.get("level") or entry.get("title"),
            "basis": basis,
            "evidence_count": entry.get("evidence_count") or 1,
        })
    return samples


def _parse_date_to_year(date_str: str | None) -> int | None:
    """Parse dates like '3/1/2021', '2021-03', 'present', etc."""
    if not date_str:
        return None
    if isinstance(date_str, int):
        return date_str
    date_str = str(date_str).strip().lower()
    if date_str in ('present', 'current', 'now'):
        return datetime.utcnow().year
    # Try to extract year from various formats
    import re
    year_match = re.search(r'(\d{4})', date_str)
    if year_match:
        return int(year_match.group(1))
    return None


def _career_from_supabase_row(row: dict[str, Any] | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not row:
        return [], []
    segments: list[dict[str, Any]] = []
    samples: list[dict[str, Any]] = []
    
    # Parse career_clean (work history without salary)
    career_clean_data = _maybe_parse_json(row.get("career_clean"))
    if isinstance(career_clean_data, list):
        for entry in career_clean_data:
            if not isinstance(entry, dict):
                continue
            company = entry.get("company")
            title = entry.get("title")
            start_year = _parse_date_to_year(entry.get("start"))
            end_year = _parse_date_to_year(entry.get("end"))
            
            if company or title:
                segment = {"org": company or "Unknown"}
                if start_year:
                    segment["start_year"] = start_year
                if end_year:
                    segment["end_year"] = end_year
                if title:
                    segment["title"] = title
                segments.append(segment)
    
    # Parse career_salary_2 (separate column with compensation data)
    career_salary_data = _maybe_parse_json(row.get("career_salary_2"))
    if isinstance(career_salary_data, list):
        for entry in career_salary_data:
            if not isinstance(entry, dict):
                continue
            company = entry.get("company")
            title = entry.get("title")
            start_year = _parse_date_to_year(entry.get("start"))
            end_year = _parse_date_to_year(entry.get("end"))
            low = entry.get("total_comp_low")
            high = entry.get("total_comp_high")
            
            # Only add salary samples if we have salary data
            if low is not None or high is not None:
                median = ((low or 0) + (high or 0)) / 2 if low and high else (low or high or 0)
                years = []
                if start_year and end_year:
                    years = list(range(start_year, end_year + 1))
                elif start_year:
                    years = [start_year]
                elif end_year:
                    years = [end_year]
                
                for year in years:
                    samples.append({
                        "year": year,
                        "org": company or "Unknown",
                        "salary_usd": median,
                        "salary_low": low,
                        "salary_high": high,
                        "band": title,
                        "basis": "career_salary_2",
                        "evidence_count": 1,
                        "source_urls": entry.get("source_urls", []),
                    })
    
    # Fall back to old format if career_clean is empty
    if not segments:
        entries = _normalize_career_entries(row.get("career_history"))
        for entry in entries:
            org = entry.get("organization") or entry.get("org") or entry.get("company") or entry.get("employer") or entry.get("name")
            title = entry.get("title") or entry.get("role")
            start = _coerce_year(entry.get("start_year") or entry.get("startYear") or entry.get("start"))
            end = _coerce_year(entry.get("end_year") or entry.get("endYear") or entry.get("end"))
            duration = entry.get("duration_years") or entry.get("duration")
            if not end and start and isinstance(duration, (int, float)):
                end = start + int(duration) - 1
            if end and start and end < start:
                end = start
            if start or end or org:
                segment = {"org": (org or "Unknown")}
                if start:
                    segment["start_year"] = start
                if end:
                    segment["end_year"] = end
                if title:
                    segment["title"] = title
                segments.append(segment)

            salary = None
            for key in ("salary_usd", "salaryUSD", "salary", "compensation_usd", "compensation", "total_compensation_usd", "totalCompUSD", "comp_usd"):
                if key in entry:
                    salary = _coerce_salary(entry[key])
                    if salary is not None:
                        break
            years: list[int] = []
            if start and end:
                years = list(range(start, end + 1))
            elif start:
                years = [start]
            elif end:
                years = [end]
            else:
                year_hint = _coerce_year(entry.get("year"))
                if year_hint:
                    years = [year_hint]
            for yy in years:
                samples.append({
                    "year": yy,
                    "org": org or "Unknown",
                    "salary_usd": salary or 0,
                    "band": entry.get("band") or entry.get("level") or title,
                    "basis": "supabase_career_clean",
                    "evidence_count": entry.get("evidence_count") or 1,
                })

    for blob, basis in (
        (row.get("career_salary"), "supabase_career_salary"),
        (row.get("career_salary_2"), "supabase_career_salary_2"),
    ):
        samples.extend(_samples_from_salary_blob(blob, basis))

    # Deduplicate entries
    seen_segments: set[tuple[Any, Any, Any]] = set()
    uniq_segments = []
    for seg in segments:
        key = (seg.get("org"), seg.get("start_year"), seg.get("end_year"))
        if key in seen_segments:
            continue
        seen_segments.add(key)
        uniq_segments.append(seg)

    seen_samples: set[tuple[Any, Any, Any, Any]] = set()
    uniq_samples = []
    for sm in samples:
        key = (sm.get("basis"), sm.get("year"), sm.get("org"), sm.get("band"))
        if key in seen_samples:
            continue
        seen_samples.add(key)
        uniq_samples.append(sm)

    uniq_samples.sort(key=lambda s: (s.get("year") or 0, s.get("org") or ""))
    return uniq_segments, uniq_samples


def _normalize_linkedin_from_user_profile(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    full_name = f"{raw.get('first_name') or ''}{(' ' + raw['last_name']) if raw.get('last_name') else ''}".strip() or None
    person = {
        "full_name": full_name,
        "first_name": raw.get("first_name"),
        "last_name": raw.get("last_name"),
        "headline": raw.get("headline"),
        "location": raw.get("location"),
        "profile_photo_url": raw.get("profile_picture_url_large") or raw.get("profile_picture_url"),
        "public_identifier": raw.get("public_identifier"),
        "linkedin_url": f"https://www.linkedin.com/in/{raw['public_identifier']}" if raw.get("public_identifier") else None,
    }
    summary = raw.get("summary")
    follower_count = raw.get("follower_count") if isinstance(raw.get("follower_count"), (int, float)) else None
    connections_count = raw.get("connections_count") if isinstance(raw.get("connections_count"), (int, float)) else None
    skills = []
    for s in raw.get("skills") or []:
        name = (s or {}).get("name") if isinstance(s, dict) else s
        if not name:
            continue
        endorsements = (s or {}).get("endorsement_count") if isinstance(s, dict) else None
        skills.append({"name": name, "endorsements": endorsements or 0})
    languages = []
    for l in raw.get("languages") or []:
        name = (l or {}).get("name") if isinstance(l, dict) else l
        if not name:
            continue
        languages.append({"name": name, "proficiency": (l or {}).get("proficiency") if isinstance(l, dict) else None})
    education = []
    for e in raw.get("education") or []:
        if not isinstance(e, dict):
            continue
        education.append({
            "school": e.get("school"),
            "degree": e.get("degree"),
            "start": e.get("start"),
            "end": e.get("end")
        })
    work = []
    for w in raw.get("work_experience") or []:
        if not isinstance(w, dict):
            continue
        work.append({
            "company": w.get("company"),
            "title": w.get("position"),
            "location": w.get("location"),
            "start": w.get("start"),
            "end": w.get("end"),
            "description": w.get("description"),
        })
    websites = [url for url in (raw.get("websites") or []) if isinstance(url, str)]
    return {
        "person": person,
        "summary": summary,
        "follower_count": follower_count,
        "connections_count": connections_count,
        "skills": skills,
        "languages": languages,
        "education": education,
        "work": work,
        "websites": websites,
    }


def _normalize_linkedin_from_clean(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    person_raw = raw.get("person") if isinstance(raw.get("person"), dict) else {}
    person = {
        "full_name": person_raw.get("full_name"),
        "first_name": person_raw.get("first_name"),
        "last_name": person_raw.get("last_name"),
        "headline": person_raw.get("headline"),
        "location": person_raw.get("location"),
        "profile_photo_url": person_raw.get("profile_photo_url"),
        "public_identifier": person_raw.get("public_identifier"),
        "linkedin_url": person_raw.get("linkedin_url"),
    }
    skills = []
    for s in raw.get("skills") or []:
        if isinstance(s, dict):
            name = s.get("name") or s.get("title")
            if not name:
                continue
            skills.append({"name": name, "endorsements": s.get("endorsement_count") or 0})
        elif isinstance(s, str):
            skills.append({"name": s, "endorsements": 0})
    languages = []
    for l in raw.get("languages") or []:
        if isinstance(l, dict):
            name = l.get("name") or l.get("language")
            if not name:
                continue
            languages.append({"name": name, "proficiency": l.get("proficiency")})
        elif isinstance(l, str):
            languages.append({"name": l, "proficiency": None})
    education = []
    for e in raw.get("education") or []:
        if isinstance(e, dict):
            education.append({"school": e.get("school") or e.get("name"), "start": e.get("start_year"), "end": e.get("end_year")})
    work = []
    for w in raw.get("experience") or []:
        if isinstance(w, dict):
            work.append({
                "company": w.get("company"),
                "title": w.get("title"),
                "location": w.get("location"),
                "start": w.get("start_date"),
                "end": w.get("end_date"),
                "description": w.get("description"),
            })
    return {
        "person": person,
        "summary": raw.get("about"),
        "follower_count": raw.get("followers_count"),
        "connections_count": raw.get("connections_count"),
        "skills": skills,
        "languages": languages,
        "education": education,
        "work": work,
        "websites": raw.get("websites") or [],
    }


def _linkedin_profile_from_row(row: dict[str, Any]) -> dict[str, Any] | None:
    """Extract LinkedIn profile from linkedin_profile_2 column (UserProfile format from Unipile)"""
    if not row:
        return None
    
    profile_2 = _maybe_parse_json(row.get("linkedin_profile_2"))
    
    if profile_2 and isinstance(profile_2, dict):
        return _normalize_linkedin_from_user_profile(profile_2)
    
    return None


def _candidate_detail_from_researcher_id(researcher_id: str) -> dict[str, Any] | None:
    try:
        researcher = get_researcher_by_id(researcher_id)
    except SupabaseUnavailable:
        return None
    except Exception:
        return None
    if not researcher:
        return None
    name = researcher.get("name") or "Unknown researcher"
    handle = _normalize_handle(researcher.get("handle"))
    corpus_row = None
    has_tweets = False
    if name:
        try:
            corpus_row = get_user_corpus_by_name(name)
            # Check if raw_json contains tweet data in Supabase
            if corpus_row and corpus_row.get("raw_json"):
                raw_json = _maybe_parse_json(corpus_row.get("raw_json"))
                if isinstance(raw_json, dict):
                    tweets = raw_json.get("tweets", [])
                    has_tweets = isinstance(tweets, list) and len(tweets) > 0
        except SupabaseUnavailable:
            corpus_row = None
        except Exception:
            corpus_row = None
    segments, samples = _career_from_supabase_row(corpus_row)
    profile = {
        "id": researcher_id,
        "name": name,
        "affiliation": researcher.get("organization"),
        "organization": researcher.get("organization"),
        "country": researcher.get("country"),
        "scholar_url": researcher.get("scholar_url"),
        "linkedin_url": researcher.get("linkedin_url") or (corpus_row or {}).get("linkedin_url"),
        "openalex_id": None,
        "openalex_url": None,
        "twitter_handle": handle,
        "has_tweets": has_tweets,
    }
    detail = {
        "profile": profile,
        "papers": [],
        "social_summary": None,
        "evidence": [],
        "career": {"segments": segments, "samples": samples},
    }
    return detail
@app.get("/candidate/{candidate_id}", response_model=CandidateDetail)
async def get_candidate(candidate_id: str) -> CandidateDetail:
    with get_session() as s:
        c = s.get(Candidate, candidate_id)
        if not c:
            supa_detail = _candidate_detail_from_researcher_id(candidate_id)
            if supa_detail:
                return CandidateDetail(**supa_detail)  # type: ignore[arg-type]
            raise HTTPException(status_code=404, detail="candidate not found")

    researcher_profile: dict[str, Any] | None = None
    corpus_row: dict[str, Any] | None = None
    try:
        researcher_profile = get_researcher_profile_by_name(c.name)
    except SupabaseUnavailable:
        researcher_profile = None
    except Exception:
        researcher_profile = None
    try:
        corpus_row = get_user_corpus_by_name(c.name)
    except SupabaseUnavailable:
        corpus_row = None
    except Exception:
        corpus_row = None

    # Get publications (may not exist)
    pubs = []
    try:
        pubs = s.exec(
            sql_text(
                """
                SELECT title, venue, year, citations, openalex_work_id
                FROM publication
                WHERE candidate_id = :cid
                ORDER BY citations DESC
                LIMIT 20
                """
            ).params(cid=candidate_id)
        ).all()
    except Exception:
        # Table doesn't exist - that's OK
        pass
    papers = [
        {
            "title": title,
            "venue": venue,
            "year": year,
            "citations": citations,
            "openalex_work_id": work_id,
            "openalex_url": _format_openalex_url(work_id),
        }
        for (title, venue, year, citations, work_id) in pubs
    ]

    # Try to get analysis summary (may not exist if search hasn't been run)
    summary = None
    try:
        summary = s.exec(
            sql_text(
                """
                SELECT topics_json, score_breakdown_json, total_score
                FROM analysis_summary
                WHERE candidate_id = :cid
                ORDER BY total_score DESC
                LIMIT 1
                """
            ).params(cid=candidate_id)
        ).first()
    except Exception:
        # Table doesn't exist or query failed - that's OK for chat-only usage
        pass
    
    social_summary = None
    evidence = []

    # Build career timeline from yearly affiliations (may not exist)
    rows = []
    try:
        rows = s.exec(
            sql_text(
                """
                SELECT org_name, year, evidence_count
                FROM affiliationyear
                WHERE candidate_id = :cid
                ORDER BY year ASC
                """
            ).params(cid=candidate_id)
        ).all()
    except Exception:
        # Table doesn't exist - that's OK
        pass

    # compress into segments of contiguous years with same org
    segments = []
    samples = []
    if rows:
        cur_org = None
        start = None
        prev_year = None
        for org_name, year, ev in rows:
            if cur_org is None:
                cur_org, start, prev_year = org_name, year, year
            elif org_name != cur_org or (prev_year is not None and year > prev_year + 1):
                segments.append({"org": cur_org, "start_year": start, "end_year": prev_year})
                cur_org, start = org_name, year
            prev_year = year
        if cur_org is not None:
            segments.append({"org": cur_org, "start_year": start, "end_year": prev_year})

        # create per-year samples with salary estimates
        for org_name, year, ev in rows:
            comp = estimate_compensation(org_name or "unknown", int(year))
            samples.append({
                "year": int(year),
                "org": org_name,
                "salary_usd": comp.amount_usd,
                "band": comp.band,
                "basis": comp.basis,
                "evidence_count": int(ev or 0),
            })

    sup_segments, sup_samples = _career_from_supabase_row(corpus_row)
    if sup_segments:
        segments = sup_segments
    if sup_samples:
        samples = sup_samples

    # Extract LinkedIn profile data from corpus_row
    linkedin_data = None
    if corpus_row:
        linkedin_data = _linkedin_profile_from_row(corpus_row)
    
    # Parse career_clean for work experience
    work_experience = []
    career_clean_data = _maybe_parse_json(corpus_row.get("career_clean")) if corpus_row else None
    if isinstance(career_clean_data, list):
        for entry in career_clean_data:
            if isinstance(entry, dict):
                work_experience.append({
                    "company": entry.get("company"),
                    "position": entry.get("title"),
                    "start": entry.get("start"),
                    "end": entry.get("end"),
                })
    
    # Fall back to linkedin_profile_2 work experience if career_clean is empty
    if not work_experience and linkedin_data:
        work_experience = linkedin_data.get("work", [])
    
    # Get education from LinkedIn profile
    education = []
    if linkedin_data:
        education = linkedin_data.get("education", [])
    
    # Check if we already have tweets locally or via Supabase raw_json
    has_tweets = False
    with get_session() as s2:
        local_count = s2.exec(
            sql_text("SELECT COUNT(*) FROM socialpost WHERE candidate_id = :cid").params(cid=candidate_id)
        ).first()
        if local_count and local_count[0] > 0:
            has_tweets = True
    if not has_tweets and corpus_row and corpus_row.get("raw_json"):
        raw_json = _maybe_parse_json(corpus_row.get("raw_json"))
        if isinstance(raw_json, dict):
            tweets = raw_json.get("tweets", [])
            has_tweets = isinstance(tweets, list) and len(tweets) > 0

    profile = {
        "id": c.id,
        "name": c.name,
        "affiliation": c.affiliation,
        "openalex_id": c.openalex_id,
        "twitter_handle": _normalize_handle(c.twitter_handle),
        "openalex_url": _format_openalex_url(c.openalex_id),
        "has_tweets": has_tweets,
    }
    
    # Add LinkedIn profile data
    if linkedin_data:
        person = linkedin_data.get("person", {})
        profile["name"] = person.get("full_name") or profile["name"]
        profile["headline"] = person.get("headline")
        profile["summary"] = linkedin_data.get("summary")
        profile["location"] = person.get("location")
        profile["profile_picture"] = person.get("profile_photo_url")
        profile["linkedin_url"] = person.get("linkedin_url")
        profile["follower_count"] = linkedin_data.get("follower_count")
        profile["connections_count"] = linkedin_data.get("connections_count")
    
    if researcher_profile:
        org = researcher_profile.get("organization")
        if org and not profile.get("affiliation"):
            profile["affiliation"] = org
        profile["organization"] = org or profile.get("affiliation")
        profile["country"] = researcher_profile.get("country")
        profile["scholar_url"] = researcher_profile.get("scholar_url")
        if not profile.get("linkedin_url"):
            profile["linkedin_url"] = researcher_profile.get("linkedin_url")
        handle_hint = _normalize_handle(researcher_profile.get("handle"))
        if handle_hint and not profile.get("twitter_handle"):
            profile["twitter_handle"] = handle_hint
    if corpus_row:
        if not profile.get("linkedin_url") and corpus_row.get("linkedin_url"):
            profile["linkedin_url"] = corpus_row.get("linkedin_url")
        corpus_handle = _normalize_handle(corpus_row.get("username"))
        if corpus_handle and not profile.get("twitter_handle"):
            profile["twitter_handle"] = corpus_handle
        if not profile.get("organization") and corpus_row.get("name"):
            profile["organization"] = profile.get("affiliation")

    if profile.get("organization") is None:
        profile["organization"] = profile.get("affiliation")
    
    # Add work experience and education to profile
    profile["work_experience"] = work_experience
    profile["education"] = education

    detail = {
        "profile": profile,
        "papers": papers,
        "social_summary": social_summary,
        "evidence": evidence,
        "career": {"segments": segments, "samples": samples},
    }
    # Pydantic model allows extra keys; CandidateDetail has top-level keys used by web
    return CandidateDetail(**detail)  # type: ignore[arg-type]


@app.post("/candidate/{candidate_id}/social")
async def update_social(candidate_id: str, payload: dict) -> dict:
    handle = payload.get("twitter_handle")
    with get_session() as s:
        c = s.get(Candidate, candidate_id)
        if not c:
            # Try to get from Supabase and create locally
            researcher_detail = _candidate_detail_from_researcher_id(candidate_id)
            if researcher_detail and researcher_detail.get("profile"):
                profile = researcher_detail["profile"]
                c = Candidate(
                    id=candidate_id,
                    name=profile.get("name", "Unknown"),
                    affiliation=profile.get("organization"),
                    twitter_handle=handle.lstrip("@") if handle else profile.get("twitter_handle")
                )
                s.add(c)
                s.commit()
                s.refresh(c)
            else:
                raise HTTPException(status_code=404, detail="candidate not found")
        if handle and c:
            c.twitter_handle = handle.lstrip("@")
            s.add(c)
            s.commit()
    return {"ok": True}


async def _ingest_tweet_texts(candidate_id: str, texts: list[tuple[str, str, int, int, str]]) -> int:
    if not texts:
        return 0
    embedder = SimpleEmbedder()
    ingested = 0
    with get_session() as s:
        existing_posts = {
            row.post_id for row in s.query(SocialPost.post_id).filter_by(candidate_id=candidate_id).all()
        }
        for post_id, text_content, like, repost, created in texts:
            if not text_content or post_id in existing_posts:
                continue
            created_dt = _coerce_created_datetime(created)
            sp = SocialPost(
                candidate_id=candidate_id,
                source="x",
                post_id=post_id,
                text=text_content,
                created_at=created_dt,
                like_count=like,
                repost_count=repost,
            )
            s.add(sp)
            s.flush()
            vec = embedder.embed_bytes(text_content)
            emb = Embedding(
                candidate_id=candidate_id,
                kind="tweet",
                ref_table="socialpost",
                ref_id=sp.id,
                model=f"hash-emb-{embedder.dim}",
                dim=embedder.dim,
                vector=vec,
            )
            s.add(emb)
            ingested += 1
            existing_posts.add(post_id)
        s.commit()
    return ingested


async def _auto_ingest_from_corpus(candidate_id: str, *, name: str | None, handle: str | None, limit: int = 400) -> bool:
    corpus_row: dict[str, Any] | None = None
    try:
        if name:
            corpus_row = get_user_corpus_by_name(name)
    except SupabaseUnavailable:
        corpus_row = None
    if not corpus_row and handle:
        try:
            corpus_row = get_user_corpus_by_username(handle.lstrip("@"))
        except SupabaseUnavailable:
            corpus_row = None
    if not corpus_row or not corpus_row.get("raw_json"):
        return False
    raw_blob = _maybe_parse_json(corpus_row.get("raw_json"))
    tweets_blob = None
    if isinstance(raw_blob, dict):
        for key in ("tweets", "items", "data"):
            maybe = raw_blob.get(key)
            if isinstance(maybe, list) and maybe:
                tweets_blob = maybe
                break
    elif isinstance(raw_blob, list):
        tweets_blob = raw_blob
    if not isinstance(tweets_blob, list) or not tweets_blob:
        return False
    texts: list[tuple[str, str, int, int, str]] = []
    for tweet in tweets_blob[:limit]:
        if not isinstance(tweet, dict):
            continue
        post_id, text_body, like, repost, created = _normalize_tweet_payload(tweet)
        if not text_body:
            continue
        texts.append((post_id, text_body, like, repost, created))
    if not texts:
        return False
    await _ingest_tweet_texts(candidate_id, texts)
    normalized_handle = _normalize_handle(corpus_row.get("username"))
    if normalized_handle:
        with get_session() as s:
            c = s.get(Candidate, candidate_id)
            if c and not c.twitter_handle:
                c.twitter_handle = normalized_handle
                s.add(c)
                s.commit()
    return True


@app.post("/candidate/{candidate_id}/ingest_tweets")
async def ingest_tweets(candidate_id: str, payload: dict | None = None) -> dict:
    payload = payload or {}
    limit = int(payload.get("limit", 200))

    # Ensure candidate exists in local database
    with get_session() as s:
        c = s.get(Candidate, candidate_id)
        if not c:
            # Try to get from Supabase and create locally
            researcher_detail = _candidate_detail_from_researcher_id(candidate_id)
            if researcher_detail and researcher_detail.get("profile"):
                profile = researcher_detail["profile"]
                c = Candidate(
                    id=candidate_id,
                    name=profile.get("name", "Unknown"),
                    affiliation=profile.get("organization"),
                    twitter_handle=payload.get("twitter_handle") or profile.get("twitter_handle")
                )
                s.add(c)
                s.commit()
                s.refresh(c)
            else:
                raise HTTPException(status_code=404, detail="candidate not found")
        handle = (c.twitter_handle or payload.get("twitter_handle"))

    texts: list[tuple[str, str, int, int, str]] = []
    
    # Path 1: Try to get tweets from Supabase raw_json first
    if c.name:
        try:
            from .supabase_repo import get_user_corpus_by_name
            corpus = get_user_corpus_by_name(c.name)
            if corpus and corpus.get("raw_json"):
                raw_json = _maybe_parse_json(corpus.get("raw_json"))
                if isinstance(raw_json, dict):
                    tweets_list = raw_json.get("tweets", [])
                    if isinstance(tweets_list, list):
                        for tweet in tweets_list[:limit]:
                            if isinstance(tweet, dict):
                                post_id = str(tweet.get("id", ""))
                                text = tweet.get("text", "")
                                like = tweet.get("likeCount", 0) or 0
                                repost = tweet.get("retweetCount", 0) or tweet.get("repostCount", 0) or 0
                                created = tweet.get("createdAt", "") or tweet.get("created_at", "")
                                if not created:
                                    created = datetime.utcnow().isoformat() + "Z"
                                if post_id and text:
                                    texts.append((post_id, text, like, repost, created))
        except Exception as e:
            print(f"Failed to load tweets from Supabase: {e}")
    
    # Path 2: Use X API if handle is set and no Supabase tweets found
    if not texts and handle:
        user = await x_client.get_user_by_username(handle)
        if user:
            max_fetch = limit if settings.twitterapi_api_key else min(limit, 100)
            tweets = await x_client.get_user_tweets(user.id, max_results=max_fetch)
            for t in tweets:
                post_id, text, like, repost, created = _normalize_tweet_payload(t)
                texts.append((post_id, text, like, repost, created))
    
    # Path 3: ingest provided texts directly (manual testing)
    for manual in payload.get("texts", []) or []:
        texts.append((
            manual.get("id") or str(hash(manual.get("text", ""))),
            manual.get("text", ""),
            0,
            0,
            manual.get("created_at") or datetime.utcnow().isoformat() + "Z",
        ))

    if not texts:
        raise HTTPException(status_code=400, detail="no tweets or texts to ingest")
    ingested = await _ingest_tweet_texts(candidate_id, texts)
    return {"ok": True, "ingested": ingested}


@app.get("/twitter/user/{username}/tweets")
async def get_user_tweets_by_username(username: str, limit: int = 100) -> dict[str, Any]:
    if limit <= 0:
        raise HTTPException(status_code=400, detail="limit must be positive")
    max_allowed = 2000 if settings.twitterapi_api_key else 100
    effective_limit = min(limit, max_allowed)
    user = await x_client.get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=404, detail="user not found")
    max_fetch = effective_limit if settings.twitterapi_api_key else min(effective_limit, 100)
    tweets_raw = await x_client.get_user_tweets(user.id, max_results=max_fetch)
    tweets_norm: list[dict[str, Any]] = []
    for tweet in tweets_raw[:effective_limit]:
        post_id, text_body, like, repost, created = _normalize_tweet_payload(tweet)
        tweets_norm.append(
            {
                "id": post_id,
                "text": text_body,
                "created_at": created,
                "like_count": like,
                "repost_count": repost,
            }
        )
    return {
        "user": {"id": user.id, "username": user.username, "name": user.name},
        "count": len(tweets_norm),
        "tweets": tweets_norm,
    }


@app.get("/candidate/{candidate_id}/tweets")
async def get_tweets(candidate_id: str, limit: int = 50) -> dict:
    with get_session() as s:
        rows = s.exec(
            sql_text(
                """
                SELECT post_id, text, created_at
                FROM socialpost
                WHERE candidate_id = :cid
                ORDER BY created_at DESC
                LIMIT :lim
                """
            ).params(cid=candidate_id, lim=limit)
        ).all()
    tweets = [
        {"post_id": pid, "text": txt, "created_at": created.isoformat()}
        for (pid, txt, created) in rows
    ]
    return {"tweets": tweets}


@app.post("/candidate/{candidate_id}/chat")
async def chat_with_candidate(candidate_id: str, payload: dict) -> dict:
    message: str = payload.get("message", "").strip()
    k: int = int(payload.get("k", 8))
    if not message:
        raise HTTPException(status_code=400, detail="message required")
    
    # Check if candidate has tweets available
    candidate_handle = None
    candidate_name = None
    with get_session() as s:
        c = s.get(Candidate, candidate_id)
        if not c:
            # Try to get from Supabase and create locally
            researcher_detail = _candidate_detail_from_researcher_id(candidate_id)
            if researcher_detail and researcher_detail.get("profile"):
                profile = researcher_detail["profile"]
                c = Candidate(
                    id=candidate_id,
                    name=profile.get("name", "Unknown"),
                    affiliation=profile.get("organization"),
                    twitter_handle=profile.get("twitter_handle")
                )
                s.add(c)
                s.commit()
                s.refresh(c)
            else:
                raise HTTPException(status_code=404, detail="candidate not found")
        candidate_handle = c.twitter_handle
        candidate_name = c.name
        # Check if tweets exist in local database
        tweet_count = s.exec(
            sql_text("SELECT COUNT(*) FROM socialpost WHERE candidate_id = :cid").params(cid=candidate_id)
        ).first()
        
        has_local_tweets = tweet_count and tweet_count[0] > 0
    
    if not has_local_tweets:
        auto_ingested = await _auto_ingest_from_corpus(
            candidate_id,
            name=candidate_name,
            handle=candidate_handle,
        )
        if auto_ingested:
            with get_session() as s:
                refreshed = s.get(Candidate, candidate_id)
                if refreshed:
                    candidate_handle = refreshed.twitter_handle
                tweet_count = s.exec(
                    sql_text("SELECT COUNT(*) FROM socialpost WHERE candidate_id = :cid").params(cid=candidate_id)
                ).first()
                has_local_tweets = tweet_count and tweet_count[0] > 0
        if not has_local_tweets:
            raise HTTPException(
                status_code=400, 
                detail="No tweet data available for this candidate. Run ingest_tweets or add Supabase raw_json."
            )
    
    # Retrieve top-k tweets as context
    contexts = query_tweets(candidate_id, message, k=k)
    if not contexts:
        raise HTTPException(
            status_code=400,
            detail="No tweets found to answer from. Please ingest tweets first."
        )
    
    handle = _normalize_handle(candidate_handle)
    candidate_name = c.name if c else "this person"
    
    # Get profile context
    with get_session() as profile_session:
        candidate = profile_session.get(Candidate, candidate_id)
        profile_info = ""
        if candidate:
            profile_info = f"Name: {candidate.name}"
            if candidate.affiliation:
                profile_info += f"\nAffiliation: {candidate.affiliation}"
    
    context_str = "\n\n".join([x['text'] for x in contexts])
    sys = f"""You are {candidate_name}. Answer questions in first person as if you're having a casual conversation.

{profile_info}

CRITICAL: Match the writing style, tone, and grammar from your tweets below. If you use:
- Technical jargon, slang, or abbreviations in tweets → use them in responses
- Short sentences or casual grammar → match that style
- Specific humor, sarcasm, or personality quirks → reflect those
- Emojis or formatting → use similar patterns

Base answers ONLY on your tweets. If you don't know something, just say you don't know. Be authentic to how you actually communicate."""
    user = f"Question: {message}\n\nYour tweets:\n{context_str}"
    # Prefer OpenRouter if configured; fall back to xAI stub otherwise
    answer = await openrouter_client.chat([
        {"role": "system", "content": sys},
        {"role": "user", "content": user},
    ])
    return {"answer": answer}


@app.post("/chat/twitter/{username}")
async def chat_from_supabase_tweets(username: str, payload: dict) -> dict:
    """Chat over Supabase-stored Twitter data.

    Strategy:
    - Prefer granular tweets from twitter_tweets (join via twitter_users.user_id)
    - Fallback to corpus doc_text from twitter_user_corpus
    - Do lightweight retrieval (hashing embeds) and answer with Grok
    """
    message: str = (payload.get("message") or "").strip()
    k: int = int(payload.get("k", 12))
    use_tools: bool = bool(payload.get("tools", True))
    if not message:
        raise HTTPException(status_code=400, detail="message required")

    # 1) Try precise tweets
    uid = None
    try:
        uid = get_user_id_by_username(username.lstrip("@"))
    except Exception:
        uid = None
    tweets: list[dict] = []
    if uid:
        try:
            tweets = get_recent_tweets_by_user_id(uid, limit=1200)
        except Exception:
            tweets = []

    # 2) Fallback to corpus doc
    corpus_doc: str | None = None
    if not tweets:
        try:
            corpus_doc = get_corpus_doc_by_username(username.lstrip("@"))
        except Exception:
            corpus_doc = None

    if not tweets and not corpus_doc:
        return {"answer": "Insufficient data for this user.", "citations": []}

    # 3) Build retrieval pool as list of items with text + id
    pool: list[dict] = []
    if tweets:
        for t in tweets:
            text = (t.get("text") or "").strip()
            if not text:
                continue
            pool.append({
                "id": t.get("tweet_id") or "",
                "text": text,
                "url": f"https://x.com/{username.lstrip('@')}/status/{t.get('tweet_id')}" if t.get("tweet_id") else None,
            })
    else:
        # Split doc_text into lines as pseudo-tweets
        for i, line in enumerate((corpus_doc or "").splitlines()):
            text = (line or "").strip()
            if not text:
                continue
            pool.append({"id": f"line_{i+1}", "text": text, "url": None})

    if not pool:
        return {"answer": "Insufficient data for this user.", "citations": []}

    if use_tools:
        # Tool-calling flow with OpenRouter (OpenAI Tools API shape)
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "retrieve_tweets",
                    "description": "Retrieve the most relevant tweets for a question from the user's Supabase-backed tweet pool.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "question or topic"},
                            "k": {"type": "integer", "description": "how many items to return", "default": k},
                        },
                        "required": ["query"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "fetch_linkedin_profile",
                    "description": "Return a minimal LinkedIn profile for this user (cleaned JSON if present).",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
        ]

        sys_msg = (
            "You answer strictly from retrieved tweets (and optionally LinkedIn when requested). "
            "Always call retrieve_tweets first with the user's question to get context; cite as [1], [2] using the returned ids."
        )
        msgs: list[dict] = [
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": message},
        ]

        # Cached embeddings for the request
        from .embeddings import SimpleEmbedder
        embedder = SimpleEmbedder()
        def _retrieve(q: str, kk: int) -> list[dict]:
            vec_q = embedder.embed(q)
            def dot(a, b):
                return sum(x*y for x, y in zip(a, b))
            capped = pool[:2000]
            vecs = [embedder.embed(item["text"]) for item in capped]
            sims = [dot(v, vec_q) for v in vecs]
            idx = sorted(range(len(sims)), key=lambda i: -sims[i])[:max(1, kk)]
            top_items = [capped[i] for i in idx]
            return top_items

        li_profile_cache = None
        async def _run_once():
            data = await openrouter_client.chat_raw(msgs, tools=tools, tool_choice="auto")
            choice = (data.get("choices") or [{}])[0]
            msg = choice.get("message", {})
            tool_calls = msg.get("tool_calls") or []
            content = msg.get("content")
            return content, tool_calls

        max_rounds = 2
        rounds = 0
        last_content = None
        citations: list[dict] = []
        while rounds < max_rounds:
            rounds += 1
            content, tool_calls = await _run_once()
            if tool_calls:
                for tc in tool_calls:
                    name = tc.get("function", {}).get("name")
                    args = tc.get("function", {}).get("arguments") or {}
                    if name == "retrieve_tweets":
                        q = args.get("query") or message
                        kk = int(args.get("k") or k)
                        items = _retrieve(q, kk)
                        # Save citations for final formatting
                        citations = [{"post_id": it["id"], "url": it.get("url")} for it in items]
                        tool_result = {
                            "context": [
                                {"id": it["id"], "text": it["text"], "url": it.get("url")} for it in items
                            ]
                        }
                    elif name == "fetch_linkedin_profile":
                        if li_profile_cache is None:
                            li_profile_cache = get_linkedin_profile(username.lstrip("@"))
                        tool_result = {"profile": li_profile_cache or {}}
                    else:
                        tool_result = {"ok": True}
                    msgs.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id"),
                        "content": json.dumps(tool_result, ensure_ascii=False),
                    })
                # continue loop for one more assistant turn
                continue
            else:
                last_content = content
                break

        if not last_content:
            last_content = "(no answer)"
        return {"answer": last_content, "citations": citations}

    # 4) Lightweight retrieval using local hashing embedder
    from .embeddings import SimpleEmbedder
    embedder = SimpleEmbedder()
    q = embedder.embed(message)
    def dot(a, b):
        return sum(x*y for x, y in zip(a, b))
    # embed pool lazily; cap for speed
    # If pool too large, subsample recent first (already recent for tweets; doc_text order is arbitrary)
    capped = pool[:2000]
    vecs = [embedder.embed(item["text"]) for item in capped]
    sims = [dot(v, q) for v in vecs]
    idx = sorted(range(len(sims)), key=lambda i: -sims[i])[:k]
    top = [capped[i] for i in idx]
    context = "\n\n".join([f"[{i+1}] {t['text']}" for i, t in enumerate(top)])

    # 5) LLM call (Grok if configured; else stub in xai connector)
    sys = (
        "You are Grok, answering strictly from the provided tweets. "
        "Cite using bracketed numbers, e.g., [1], [2]. If the answer isn't in the tweets, say you don't know."
    )
    user = f"Question: {message}\n\nTweets:\n{context}"
    answer = await openrouter_client.chat([
        {"role": "system", "content": sys},
        {"role": "user", "content": user},
    ])

    citations = [{"post_id": t["id"], "url": t.get("url") } for t in top]
    return {"answer": answer, "citations": citations}


@app.get("/relationships")
async def get_relationships(limit: int = 2000) -> dict[str, Any]:
    """Get all Twitter relationships."""
    try:
        relationships = get_all_relationships(limit=limit)
        return {"count": len(relationships), "relationships": relationships}
    except SupabaseUnavailable:
        raise HTTPException(status_code=503, detail="Supabase unavailable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/relationships/{username}")
async def get_user_relationships(username: str, limit: int = 500) -> dict[str, Any]:
    """Get relationships for a specific user."""
    try:
        relationships = get_relationships_by_username(username, limit=limit)
        profile = get_user_profile_info(username)
        return {
            "username": username,
            "profile": profile,
            "count": len(relationships),
            "relationships": relationships,
        }
    except SupabaseUnavailable:
        raise HTTPException(status_code=503, detail="Supabase unavailable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/relationships/network/stats")
async def get_network_stats() -> dict[str, Any]:
    """Get network statistics."""
    try:
        relationships = get_all_relationships(limit=5000)
        usernames = set()
        mutual_count = 0
        following_count = 0
        follower_count = 0
        
        for rel in relationships:
            usernames.add(rel["source_username"])
            usernames.add(rel["target_username"])
            
            if rel["following"] and rel["followed_by"]:
                mutual_count += 1
            elif rel["following"]:
                following_count += 1
            elif rel["followed_by"]:
                follower_count += 1
        
        return {
            "total_relationships": len(relationships),
            "unique_users": len(usernames),
            "mutual_follows": mutual_count,
            "one_way_following": following_count,
            "one_way_followers": follower_count,
        }
    except SupabaseUnavailable:
        raise HTTPException(status_code=503, detail="Supabase unavailable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/relationships/profiles/batch")
async def get_batch_profiles(payload: dict[str, Any]) -> dict[str, Any]:
    """Get multiple user profiles in one request."""
    usernames = payload.get("usernames", [])
    if not usernames or not isinstance(usernames, list):
        raise HTTPException(status_code=400, detail="usernames array required")
    
    if len(usernames) > 500:
        raise HTTPException(status_code=400, detail="Maximum 500 usernames per request")
    
    try:
        profiles = get_batch_user_profiles(usernames)
        return {"count": len(profiles), "profiles": profiles}
    except SupabaseUnavailable:
        raise HTTPException(status_code=503, detail="Supabase unavailable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
