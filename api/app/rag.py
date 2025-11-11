from __future__ import annotations

import json
from typing import List, Tuple
from array import array
import math

from .db import get_session
from .embeddings import SimpleEmbedder, cosine_similarity
from .models import Embedding, SocialPost


def _load_tweet_embeddings(candidate_id: str) -> Tuple[List[str], List[List[float]], List[str]]:
    """Return (embedding_ids, matrix(list of vectors), post_ids)."""
    with get_session() as s:
        # Use ORM query to avoid exec() parameter issues
        results = s.query(Embedding.id, Embedding.vector, Embedding.dim, SocialPost.post_id)\
            .join(SocialPost, SocialPost.id == Embedding.ref_id)\
            .filter(Embedding.candidate_id == candidate_id, Embedding.kind == 'tweet')\
            .all()
        rows = results
    if not rows:
        return [], [], []
    dims = rows[0][2]
    vecs: List[List[float]] = []
    emb_ids = []
    post_ids = []
    for emb_id, vec_bytes, dim, post_id in rows:
        if dim != dims:
            continue
        arr = array("f")
        arr.frombytes(vec_bytes)
        vecs.append(list(arr))
        emb_ids.append(emb_id)
        post_ids.append(post_id)
    if not vecs:
        return [], [], []
    return emb_ids, vecs, post_ids


def query_tweets(candidate_id: str, query: str, k: int = 8) -> List[dict]:
    embedder = SimpleEmbedder()
    q_vec = embedder.embed(query)
    _, mat, post_ids = _load_tweet_embeddings(candidate_id)
    if not mat:
        return []
    # cosine between q and each row (both normalized already)
    def dot(a: List[float], b: List[float]) -> float:
        return sum(x * y for x, y in zip(a, b))
    sims = [dot(row, q_vec) for row in mat]
    top_idx = sorted(range(len(sims)), key=lambda i: -sims[i])[:k]
    selected_post_ids = [post_ids[i] for i in top_idx]
    # fetch texts
    # Simpler: fetch all tweets for candidate and filter in memory (prototype scale)
    with get_session() as s:
        rows = s.query(SocialPost.post_id, SocialPost.text, SocialPost.created_at)\
            .filter(SocialPost.candidate_id == candidate_id)\
            .all()
    results = []
    selected_set = set(selected_post_ids)
    for post_id, text, created_at in rows:
        if post_id in selected_set:
            results.append({"post_id": post_id, "text": text, "created_at": created_at.isoformat()})
    # maintain the original order by similarity
    id2obj = {r["post_id"]: r for r in results}
    ordered = [id2obj[i] for i in selected_post_ids if i in id2obj]
    return ordered
