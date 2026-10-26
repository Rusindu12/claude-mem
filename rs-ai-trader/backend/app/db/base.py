"""SQLAlchemy 2.0 engine/session wiring.

PostgreSQL is the supported production database; SQLite is accepted for the
test-suite and quick local runs (``DATABASE_URL=sqlite:///./rsai.db``).
"""
from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from contextlib import contextmanager

from datetime import datetime, timezone

from sqlalchemy import DateTime, create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import TypeDecorator

from ..core.config import Settings, get_settings

log = logging.getLogger(__name__)


class UTCDateTime(TypeDecorator):
    """Timezone-aware datetime that behaves identically on PostgreSQL and SQLite.

    SQLite drops tzinfo, which would otherwise produce naive/aware comparison
    bugs in session-expiry and cooldown logic.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class Base(DeclarativeBase):
    pass


_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def build_engine(settings: Settings | None = None) -> Engine:
    settings = settings or get_settings()
    url = settings.database_url
    kwargs: dict = {
        "echo": settings.db_echo,
        "future": True,
        "pool_pre_ping": True,
        # JSON columns carry Decimals (prices, limits) — serialise them safely.
        "json_serializer": lambda value: json.dumps(value, default=str),
    }
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url or url.rstrip("/") == "sqlite:":
            # Keep a single shared connection so in-memory databases persist
            # across sessions (tests, quick local runs).
            kwargs["poolclass"] = StaticPool
    else:
        kwargs.update(pool_size=settings.db_pool_size, max_overflow=settings.db_max_overflow)
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _record):  # pragma: no cover - sqlite only
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = build_engine()
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)
    return _session_factory


def configure_database(engine: Engine) -> None:
    """Point the global session factory at ``engine`` (used by tests)."""
    global _engine, _session_factory
    _engine = engine
    _session_factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)


def session_scope() -> Session:
    return get_session_factory()()


@contextmanager
def transactional() -> Iterator[Session]:
    session = session_scope()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def create_all(engine: Engine | None = None) -> None:
    from . import models  # noqa: F401  (register tables)

    Base.metadata.create_all(bind=engine or get_engine())


def drop_all(engine: Engine | None = None) -> None:
    from . import models  # noqa: F401

    Base.metadata.drop_all(bind=engine or get_engine())


def get_db() -> Iterator[Session]:
    """FastAPI dependency."""
    session = session_scope()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
