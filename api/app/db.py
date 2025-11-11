from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from .config import get_settings


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.db_url.startswith("sqlite") else {}
engine = create_engine(settings.db_url, echo=False, connect_args=connect_args)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _ensure_column("publication", "openalex_work_id", "TEXT")


@contextmanager
def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def _ensure_column(table_name: str, column_name: str, column_type_sql: str) -> None:
    """Best-effort addition of optional columns in SQLite/Postgres."""
    try:
        inspector = inspect(engine)
        existing = {col["name"] for col in inspector.get_columns(table_name)}
        if column_name in existing:
            return
    except SQLAlchemyError:
        return

    ddl = f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type_sql}"
    try:
        with engine.begin() as conn:
            conn.execute(text(ddl))
    except SQLAlchemyError:
        # Ignore – column might already exist or ALTER TABLE not supported in current dialect
        return
