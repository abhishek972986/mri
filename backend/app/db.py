"""Database engine and session management."""

from __future__ import annotations

import logging
from collections.abc import Iterator

from sqlalchemy import inspect, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from .config import settings

logger = logging.getLogger(__name__)

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
    _add_missing_columns()


def _add_missing_columns() -> None:
    """Additive migration for tables that already exist.

    `create_all` creates missing tables but never alters existing ones, so a
    database from before a column was added would fail on the first query that
    touches it. Every column added since is nullable (or has a server-side
    default here), which makes ADD COLUMN safe: existing rows are kept and the
    new fields start empty. Anything non-additive needs a real migration tool.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as connection:
        for table in SQLModel.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            present = {column["name"] for column in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in present:
                    continue
                column_type = column.type.compile(dialect=engine.dialect)
                default = ""
                if not column.nullable:
                    # Only booleans are non-nullable among added columns.
                    default = " NOT NULL DEFAULT 1" if column.name == "is_active" else " DEFAULT 0"
                connection.execute(
                    text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {column_type}{default}')
                )
                logger.info("Migrated: added %s.%s", table.name, column.name)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
