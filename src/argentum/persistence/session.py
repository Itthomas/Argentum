from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker


def create_sqlalchemy_engine(database_url: str, *, echo: bool = False) -> Engine:
    return create_engine(database_url, echo=echo, future=True)


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)