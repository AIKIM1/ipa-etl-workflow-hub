"""Control PostgreSQL repository for reusable ETL database connections."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from functools import lru_cache
from uuid import uuid4

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Boolean, JSON, Column, DateTime, Integer, MetaData, String, Table, Text, create_engine, delete, insert, select, update
from sqlalchemy.engine import Engine

from .connection_models import DatabaseConnectionInput, StoredConnection


class ConnectionRepositoryError(RuntimeError):
    """Raised when the control database cannot persist a connection."""


class ConnectionNotFoundError(ConnectionRepositoryError):
    """Raised when a requested reusable connection does not exist."""


metadata = MetaData()

connections_table = Table(
    "connections",
    metadata,
    Column("connection_id", String(32), primary_key=True),
    Column("connection_name", String(100), nullable=False, unique=True, index=True),
    Column("database_type", String(20), nullable=False),
    Column("host", String(255), nullable=False),
    Column("port", Integer, nullable=False),
    Column("database_name", String(255)),
    Column("service_name", String(255)),
    Column("sid", String(255)),
    Column("default_schema", String(255)),
    Column("username", String(255), nullable=False),
    Column("encrypted_password", Text),
    Column("password_env_key", String(255)),
    Column("connection_role", String(20), nullable=False),
    Column("environment", String(20), nullable=False),
    Column("connect_timeout", Integer, nullable=False),
    Column("pool_size", Integer, nullable=False),
    Column("max_overflow", Integer, nullable=False),
    Column("use_ssl", Boolean, nullable=False),
    Column("read_only", Boolean, nullable=False),
    Column("description", Text),
    Column("status", String(20), nullable=False),
    Column("schemas", JSON, nullable=False, default=list),
    Column("tables", JSON, nullable=False, default=list),
    Column("last_tested_at", DateTime(timezone=True)),
    Column("last_response_time_ms", Integer),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)


@lru_cache(maxsize=1)
def get_control_engine() -> Engine:
    """Returns the IPA control PostgreSQL engine, never an ETL target connection."""
    database_url = os.getenv("CONTROL_DATABASE_URL")
    if not database_url:
        raise ConnectionRepositoryError("CONTROL_DATABASE_URL is not configured.")
    return create_engine(database_url, pool_pre_ping=True)


def initialize_control_database() -> None:
    """Creates the Connection Repository table when the control DB is configured."""
    try:
        metadata.create_all(get_control_engine(), tables=[connections_table])
    except ConnectionRepositoryError:
        raise
    except Exception as error:
        raise ConnectionRepositoryError(f"Could not initialize control database: {error.__class__.__name__}") from error


def _fernet() -> Fernet:
    key = os.getenv("CONNECTION_ENCRYPTION_KEY")
    if not key:
        raise ConnectionRepositoryError("CONNECTION_ENCRYPTION_KEY is required to store a direct password.")
    try:
        return Fernet(key.encode("utf-8"))
    except ValueError as error:
        raise ConnectionRepositoryError("CONNECTION_ENCRYPTION_KEY must be a valid Fernet key.") from error


def _encrypt_password(password: str | None) -> str | None:
    if not password:
        return None
    return _fernet().encrypt(password.encode("utf-8")).decode("utf-8")


def _decrypt_password(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as error:
        raise ConnectionRepositoryError("Stored connection password could not be decrypted.") from error


def _payload_values(payload: DatabaseConnectionInput, test_result: dict[str, object] | None = None) -> dict[str, object]:
    password = payload.password.get_secret_value() if payload.password is not None else None
    now = datetime.now(UTC)
    return {
        "connection_name": payload.connection_name,
        "database_type": payload.database_type.value,
        "host": payload.host,
        "port": payload.port,
        "database_name": payload.database_name,
        "service_name": payload.service_name,
        "sid": payload.sid,
        "default_schema": payload.default_schema,
        "username": payload.username,
        "encrypted_password": _encrypt_password(password),
        "password_env_key": payload.password_env_key,
        "connection_role": payload.connection_role.value,
        "environment": payload.environment.value,
        "connect_timeout": payload.connect_timeout,
        "pool_size": payload.pool_size,
        "max_overflow": payload.max_overflow,
        "use_ssl": payload.use_ssl,
        "read_only": payload.read_only,
        "description": payload.description,
        "status": "ACTIVE",
        "schemas": [payload.default_schema] if payload.default_schema else [],
        "tables": [],
        "last_tested_at": now if test_result else None,
        "last_response_time_ms": test_result.get("response_time_ms") if test_result else None,
        "updated_at": now,
    }


class ConnectionRepository:
    """Persists connection definitions and reconstructs server-only connection configs."""

    def create(self, payload: DatabaseConnectionInput, test_result: dict[str, object] | None = None) -> StoredConnection:
        values = _payload_values(payload, test_result)
        values["connection_id"] = f"CONN_{uuid4().hex[:8].upper()}"
        values["created_at"] = datetime.now(UTC)

        try:
            with get_control_engine().begin() as connection:
                connection.execute(insert(connections_table).values(**values))
        except ConnectionRepositoryError:
            raise
        except Exception as error:
            raise ConnectionRepositoryError(f"Could not save connection: {error.__class__.__name__}") from error
        return self.get(values["connection_id"])

    def list(self) -> list[StoredConnection]:
        try:
            with get_control_engine().connect() as connection:
                rows = connection.execute(select(connections_table).order_by(connections_table.c.connection_name)).mappings().all()
        except ConnectionRepositoryError:
            raise
        except Exception as error:
            raise ConnectionRepositoryError(f"Could not read connections: {error.__class__.__name__}") from error
        return [self._to_stored_connection(row) for row in rows]

    def get(self, connection_id: str) -> StoredConnection:
        try:
            with get_control_engine().connect() as connection:
                row = connection.execute(
                    select(connections_table).where(connections_table.c.connection_id == connection_id)
                ).mappings().one_or_none()
        except ConnectionRepositoryError:
            raise
        except Exception as error:
            raise ConnectionRepositoryError(f"Could not read connection: {error.__class__.__name__}") from error
        if row is None:
            raise ConnectionNotFoundError(f"Connection not found: {connection_id}")
        return self._to_stored_connection(row)

    def update(self, connection_id: str, payload: DatabaseConnectionInput, test_result: dict[str, object] | None = None) -> StoredConnection:
        self.get(connection_id)
        values = _payload_values(payload, test_result)
        values.pop("created_at", None)
        try:
            with get_control_engine().begin() as connection:
                connection.execute(
                    update(connections_table)
                    .where(connections_table.c.connection_id == connection_id)
                    .values(**values)
                )
        except ConnectionRepositoryError:
            raise
        except Exception as error:
            raise ConnectionRepositoryError(f"Could not update connection: {error.__class__.__name__}") from error
        return self.get(connection_id)

    def delete(self, connection_id: str) -> None:
        try:
            with get_control_engine().begin() as connection:
                result = connection.execute(delete(connections_table).where(connections_table.c.connection_id == connection_id))
        except ConnectionRepositoryError:
            raise
        except Exception as error:
            raise ConnectionRepositoryError(f"Could not delete connection: {error.__class__.__name__}") from error
        if result.rowcount == 0:
            raise ConnectionNotFoundError(f"Connection not found: {connection_id}")

    def update_metadata(self, connection_id: str, metadata_values: dict[str, object], status: str = "ACTIVE") -> StoredConnection:
        self.get(connection_id)
        values = {
            "default_schema": metadata_values.get("default_schema"),
            "schemas": metadata_values.get("schemas", []),
            "tables": metadata_values.get("tables", []),
            "status": status,
            "updated_at": datetime.now(UTC),
        }
        with get_control_engine().begin() as connection:
            connection.execute(
                update(connections_table)
                .where(connections_table.c.connection_id == connection_id)
                .values(**values)
            )
        return self.get(connection_id)

    def _to_stored_connection(self, row: object) -> StoredConnection:
        data = dict(row)
        password = _decrypt_password(data.get("encrypted_password"))
        config = DatabaseConnectionInput(
            connection_name=data["connection_name"],
            database_type=data["database_type"],
            host=data["host"],
            port=data["port"],
            database_name=data["database_name"],
            service_name=data["service_name"],
            sid=data["sid"],
            default_schema=data["default_schema"],
            username=data["username"],
            password=password,
            password_env_key=data["password_env_key"],
            connection_role=data["connection_role"],
            environment=data["environment"],
            connect_timeout=data["connect_timeout"],
            pool_size=data["pool_size"],
            max_overflow=data["max_overflow"],
            use_ssl=bool(data["use_ssl"]),
            read_only=bool(data["read_only"]),
            description=data["description"],
        )
        return StoredConnection(
            connection_id=data["connection_id"],
            status=data["status"],
            default_schema=data["default_schema"],
            schemas=data["schemas"] or [],
            tables=data["tables"] or [],
            config=config,
        )
