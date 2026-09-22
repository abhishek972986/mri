"""Database engine and session management."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from .config import settings

_url = settings.resolved_database_url
_is_sqlite = _url.startswith("sqlite")

# check_same_thread=False because analyses run on FastAPI's worker threads, which
# are not the thread that opened the connection.
engine = create_engine(
    _url,
    echo=False,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    poolclass=StaticPool if ":memory:" in _url else None,
)


def init_db() -> None:
    settings.ensure_dirs()
    from . import models  # noqa: F401  (import registers the tables)

    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
