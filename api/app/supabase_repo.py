from __future__ import annotations

from typing import List, Optional, Dict, Any

from .supabase_client import supabase_select, SupabaseUnavailable


def _select_first(table: str, column: str, value: str, fields: str) -> Optional[Dict[str, Any]]:
    try:
        rows = supabase_select(table, select=fields, filters={column: f"eq.{value}"}, limit=1)
        if rows:
            return rows[0]
        rows = supabase_select(table, select=fields, filters={column: f"ilike.{value}"}, limit=1)
        return rows[0] if rows else None
    except SupabaseUnavailable:
        raise
    except Exception:
        raise


def get_researcher_profile_by_name(name: str) -> Optional[Dict[str, Any]]:
    return _select_first(
        table="researchers",
        column="name",
        value=name,
        fields="name,organization,country,handle,scholar_url,linkedin_url",
    )


LINKEDIN_FIELDS = "user_id,username,name,career_clean,career_salary,career_salary_2,linkedin_url,linkedin_profile,linkedin_profile_clean,linkedin_profile_2,raw_json"


def get_user_corpus_by_name(name: str) -> Optional[Dict[str, Any]]:
    return _select_first(
        table="twitter_user_corpus",
        column="name",
        value=name,
        fields=LINKEDIN_FIELDS,
    )


def get_user_corpus_by_username(username: str) -> Optional[Dict[str, Any]]:
    return _select_first(
        table="twitter_user_corpus",
        column="username",
        value=username,
        fields=LINKEDIN_FIELDS,
    )


def list_researchers(limit: int = 1000) -> List[Dict[str, Any]]:
    lim = max(1, min(2000, int(limit or 0) or 1000))
    return supabase_select(
        "researchers",
        select="id,name,organization,country,handle,scholar_url,linkedin_url",
        order="name",
        limit=lim,
    )


def get_researcher_by_id(researcher_id: str) -> Optional[Dict[str, Any]]:
    rows = supabase_select(
        "researchers",
        select="id,name,organization,country,handle,scholar_url,linkedin_url",
        filters={"id": f"eq.{researcher_id}"},
        limit=1,
    )
    return rows[0] if rows else None


def get_user_id_by_username(username: str) -> Optional[str]:
    rows = supabase_select(
        "twitter_users",
        select="user_id",
        filters={"username": f"ilike.{username}"},
        limit=1,
    )
    if not rows:
        rows = supabase_select(
            "twitter_users",
            select="user_id",
            filters={"username": f"eq.{username}"},
            limit=1,
        )
    return rows[0]["user_id"] if rows else None


def get_recent_tweets_by_user_id(user_id: str, *, limit: int = 800) -> List[Dict[str, Any]]:
    return supabase_select(
        "twitter_tweets",
        select="tweet_id,text,created_at_utc",
        filters={"author_id": f"eq.{user_id}"},
        order="created_at_utc.desc",
        limit=max(1, min(2000, int(limit))),
    )


def get_corpus_doc_by_username(username: str) -> Optional[str]:
    rows = supabase_select(
        "twitter_user_corpus",
        select="doc_text",
        filters={"username": f"ilike.{username}"},
        limit=1,
    )
    if not rows:
        rows = supabase_select(
            "twitter_user_corpus",
            select="doc_text",
            filters={"username": f"eq.{username}"},
            limit=1,
        )
    if not rows:
        return None
    return rows[0].get("doc_text")


def get_linkedin_profile(username: str) -> Optional[Dict[str, Any]]:
    row = get_linkedin_profile_row(username)
    if not row:
        return None
    return row.get("linkedin_profile_2")


def get_linkedin_profile_row(username: str) -> Optional[Dict[str, Any]]:
    return _select_first(
        table="twitter_user_corpus",
        column="username",
        value=username,
        fields="username,name,linkedin_profile_2",
    )


def get_all_relationships(limit: int = 2000) -> List[Dict[str, Any]]:
    lim = max(1, min(5000, int(limit or 0) or 2000))
    return supabase_select(
        "twitter_relationships",
        select="id,source_username,target_username,following,followed_by,checked_at",
        order="checked_at.desc",
        limit=lim,
    )


def get_relationships_by_username(username: str, limit: int = 500) -> List[Dict[str, Any]]:
    lim = max(1, min(2000, int(limit or 0) or 500))
    try:
        rows = supabase_select(
            "twitter_relationships",
            select="id,source_username,target_username,following,followed_by,checked_at",
            filters={"source_username": f"eq.{username}"},
            order="checked_at.desc",
            limit=lim,
        )
        return rows
    except SupabaseUnavailable:
        raise
    except Exception:
        return []


def get_user_profile_info(username: str) -> Optional[Dict[str, Any]]:
    return _select_first(
        table="twitter_user_corpus",
        column="username",
        value=username,
        fields="username,name,linkedin_profile_2",
    )


def get_batch_user_profiles(usernames: List[str]) -> List[Dict[str, Any]]:
    """Get multiple user profiles in one query."""
    if not usernames:
        return []
    
    # Supabase 'in' filter format
    usernames_str = ",".join(f'"{u}"' for u in usernames)
    try:
        rows = supabase_select(
            "twitter_user_corpus",
            select="username,name,linkedin_profile_2",
            filters={"username": f"in.({usernames_str})"},
            limit=len(usernames),
        )
        return rows
    except SupabaseUnavailable:
        raise
    except Exception:
        return []
