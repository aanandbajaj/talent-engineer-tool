import uuid
from datetime import datetime
from typing import List, Optional

from sqlmodel import SQLModel, Field, Relationship


class JobStatus:
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


class Job(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, index=True)
    query: str
    job_description: Optional[str] = None
    filters_json: Optional[str] = None
    status: str = Field(default=JobStatus.PENDING)
    progress: int = Field(default=0)
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Candidate(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    name: str
    affiliation: Optional[str] = None
    openalex_id: Optional[str] = Field(default=None, index=True)
    twitter_handle: Optional[str] = None
    followers: Optional[int] = 0

    publications: List["Publication"] = Relationship(back_populates="candidate")
    analyses: List["AnalysisSummary"] = Relationship(back_populates="candidate")


class Publication(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    candidate_id: str = Field(foreign_key="candidate.id")
    title: str
    venue: Optional[str] = None
    year: Optional[int] = None
    citations: Optional[int] = 0
    abstract: Optional[str] = None
    openalex_work_id: Optional[str] = Field(default=None, index=True)

    candidate: Candidate = Relationship(back_populates="publications")


class SocialPost(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    candidate_id: str = Field(foreign_key="candidate.id")
    source: str = Field(default="x")  # x (twitter), github, etc.
    post_id: str
    text: str
    created_at: datetime
    like_count: Optional[int] = 0
    repost_count: Optional[int] = 0


class AnalysisSummary(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    candidate_id: str = Field(foreign_key="candidate.id")
    topics_json: Optional[str] = None  # JSON string list
    methods_json: Optional[str] = None
    personality_json: Optional[str] = None
    score_breakdown_json: Optional[str] = None
    total_score: float = 0.0

    candidate: Candidate = Relationship(back_populates="analyses")


class AffiliationYear(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    candidate_id: str = Field(foreign_key="candidate.id")
    org_name: str
    year: int
    evidence_count: int = 1


class Embedding(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    candidate_id: str = Field(foreign_key="candidate.id")
    kind: str = Field(default="tweet")  # tweet, paper, etc.
    ref_table: str = Field(default="socialpost")
    ref_id: str  # maps to SocialPost.id
    model: str = Field(default="hash-emb-512")
    dim: int = Field(default=512)
    vector: bytes  # float32 bytes
    created_at: datetime = Field(default_factory=datetime.utcnow)
