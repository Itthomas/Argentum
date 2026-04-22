from __future__ import annotations

from logging.config import fileConfig
import os

from alembic import context
from sqlalchemy import engine_from_config, pool

from argentum.persistence.base import metadata
from argentum.persistence import metadata as _loaded_metadata  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = metadata


def _resolve_database_url() -> str:
    configured_url = config.get_main_option("sqlalchemy.url").strip()
    return os.getenv("ARGENTUM_DATABASE_URL") or configured_url


def run_migrations_offline() -> None:
    url = _resolve_database_url()
    if not url:
        raise RuntimeError("Alembic requires ARGENTUM_DATABASE_URL or sqlalchemy.url to be configured")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"})

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _resolve_database_url()
    if not url:
        raise RuntimeError("Alembic requires ARGENTUM_DATABASE_URL or sqlalchemy.url to be configured")

    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = url
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()