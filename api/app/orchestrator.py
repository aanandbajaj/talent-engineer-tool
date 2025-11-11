from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Any

from .db import get_session
from .models import Job, JobStatus, Candidate, Publication, AnalysisSummary, AffiliationYear
from .connectors import openalex
from .ranking import basic_topics_from_publications, score_candidate
from .llm import LLMProvider
from sqlalchemy import text as sql_text


class JobEvents:
    def __init__(self) -> None:
        self._queues: dict[str, asyncio.Queue[str]] = {}

    def get_queue(self, job_id: str) -> asyncio.Queue[str]:
        q = self._queues.get(job_id)
        if q is None:
            q = asyncio.Queue()
            self._queues[job_id] = q
        return q

    async def emit(self, job_id: str, event: dict[str, Any]) -> None:
        q = self.get_queue(job_id)
        await q.put(json.dumps(event))

    def remove(self, job_id: str) -> None:
        self._queues.pop(job_id, None)


events = JobEvents()


async def run_search(job_id: str) -> None:
    # Update job to running
    with get_session() as s:
        job = s.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.RUNNING
        job.progress = 1
        job.updated_at = datetime.utcnow()
        s.add(job)
        s.commit()

    await events.emit(job_id, {"type": "progress", "progress": 1})

    try:
        llm = LLMProvider()
        # Load full job context
        with get_session() as s:
            job = s.get(Job, job_id)
        query = job.query if job else ""
        filters = {}
        if job and job.filters_json:
            try:
                filters = json.loads(job.filters_json)
            except Exception:
                filters = {}
        job_text = (job.job_description or "").strip()
        # discovery by query (fall back to job_text keywords if query empty)
        discover_query = query or job_text or "ai researcher"
        authors = await openalex.search_authors(discover_query, limit=10)
        if not authors:
            with get_session() as s:
                job = s.get(Job, job_id)
                if job:
                    job.status = JobStatus.DONE
                    job.progress = 100
                    job.updated_at = datetime.utcnow()
                    s.add(job)
                    s.commit()
            await events.emit(job_id, {"type": "finished"})
            return

        step = 0
        total = len(authors)
        now_year = datetime.utcnow().year
        # job side features
        from .embeddings import SimpleEmbedder, cosine_similarity
        from .utils import top_keywords
        embedder = SimpleEmbedder()
        job_keywords = top_keywords([job_text or query], k=12)
        job_vec = embedder.embed(job_text or query)
        requested_level = (filters.get("seniority") or None)

        for author in authors:
            works = await openalex.fetch_top_works(author.id, per_page=10)
            texts = [w.get("title", "") + "\n" + (w.get("abstract") or "") for w in works]
            topics = await llm.extract_topics(texts, k=8)
            best_citations = max([w.get("citations", 0) for w in works] + [0])
            recent_year = max([w.get("year") or 0 for w in works] + [0]) or None
            # crude h-index proxy from counts
            h_approx = min(author.works_count ** 0.5, author.cited_by_count ** 0.4)
            # embedding fit
            cand_text = "\n\n".join(texts)[:8000]
            cand_vec = embedder.embed(cand_text)
            embed_fit = float(cosine_similarity(cand_vec, job_vec))
            # seniority
            first_year = min([w.get("year") or now_year for w in works] + [now_year])
            years_active = max(1, now_year - first_year + 1)
            from .ranking import estimate_seniority, seniority_fit_score
            seniority_level = estimate_seniority(years_active, h_approx, author.works_count)
            seniority_fit = seniority_fit_score(seniority_level, requested_level)
            score, breakdown = score_candidate(
                query_keywords=job_keywords or query.split(),
                topics=topics,
                h_approx=h_approx,
                best_citations=best_citations,
                recent_year=recent_year,
                current_year=now_year,
                embed_similarity=embed_fit,
                seniority_fit=seniority_fit,
            )
            breakdown["seniority"] = seniority_level
            breakdown["requested_level"] = requested_level

            # persist candidate and works
            with get_session() as s:
                c = Candidate(
                    name=author.display_name,
                    affiliation=author.affiliation,
                    openalex_id=author.id,
                )
                s.add(c)
                s.commit()
                s.refresh(c)

                for w in works:
                    pub = Publication(
                        candidate_id=c.id,
                        title=w.get("title"),
                        venue=w.get("venue"),
                        year=w.get("year"),
                        citations=w.get("citations", 0),
                        abstract=w.get("abstract"),
                        openalex_work_id=w.get("work_id"),
                    )
                    s.add(pub)
                    # derive yearly affiliation from authorship institution if present
                    org = w.get("org_at_publication")
                    yr = w.get("year")
                    if org and isinstance(yr, int):
                        # check if a record exists for same (candidate, year, org)
                        existing = s.exec(
                            sql_text(
                                """
                                SELECT id, evidence_count FROM affiliationyear
                                WHERE candidate_id = :cid AND year = :yr AND org_name = :org
                                LIMIT 1
                                """
                            ).params(cid=c.id, yr=yr, org=org)
                        ).first()
                        if existing:
                            # increment evidence count
                            aff_id, ev = existing
                            s.exec(
                                sql_text("UPDATE affiliationyear SET evidence_count = :ev WHERE id = :id").params(ev=int(ev or 0) + 1, id=aff_id)
                            )
                        else:
                            s.add(AffiliationYear(candidate_id=c.id, org_name=org, year=yr, evidence_count=1))

                summary = AnalysisSummary(
                    candidate_id=c.id,
                    topics_json=json.dumps(topics),
                    methods_json=None,
                    personality_json=None,
                    score_breakdown_json=json.dumps(breakdown),
                    total_score=score,
                )
                s.add(summary)
                s.commit()

                # Emit partial to client
                await events.emit(
                    job_id,
                    {
                        "type": "candidate",
                        "candidate": {
                            "candidate_id": c.id,
                            "name": c.name,
                            "affiliation": c.affiliation,
                            "topics": topics,
                            "score": score,
                            "seniority": seniority_level,
                        },
                    },
                )

            step += 1
            progress = int(5 + (step / max(1, total)) * 90)
            with get_session() as s:
                job = s.get(Job, job_id)
                if job:
                    job.progress = progress
                    job.updated_at = datetime.utcnow()
                    s.add(job)
                    s.commit()
            await events.emit(job_id, {"type": "progress", "progress": progress})

        with get_session() as s:
            job = s.get(Job, job_id)
            if job:
                job.progress = 100
                job.status = JobStatus.DONE
                job.updated_at = datetime.utcnow()
                s.add(job)
                s.commit()
        await events.emit(job_id, {"type": "finished"})
    except Exception as e:  # noqa: BLE001
        with get_session() as s:
            job = s.get(Job, job_id)
            if job:
                job.status = JobStatus.ERROR
                job.error = str(e)
                job.updated_at = datetime.utcnow()
                s.add(job)
                s.commit()
        await events.emit(job_id, {"type": "error", "message": str(e)})
