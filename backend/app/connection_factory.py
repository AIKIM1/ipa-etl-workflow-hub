from __future__ import annotations

import os
from time import perf_counter

from sqlalchemy import URL, Engine, create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from .connection_models import DatabaseConnectionInput, DatabaseType


class DatabaseConnectionError(RuntimeError):
    """DB 연결 생성 또는 테스트 실패를 API 오류로 변환하기 위한 예외입니다."""


def resolve_password(config: DatabaseConnectionInput) -> str:
    """직접 입력한 비밀번호 또는 환경변수 키에서 실제 비밀번호를 읽습니다."""
    if config.password is not None:
        return config.password.get_secret_value()

    if not config.password_env_key:
        raise DatabaseConnectionError("비밀번호 참조값이 없습니다.")

    password = os.getenv(config.password_env_key)
    if not password:
        raise DatabaseConnectionError(f"환경변수가 존재하지 않습니다: {config.password_env_key}")

    return password


def build_database_url(config: DatabaseConnectionInput) -> URL:
    """DB 유형별 SQLAlchemy URL을 구조적으로 생성합니다."""
    password = resolve_password(config)

    if config.database_type == DatabaseType.POSTGRESQL:
        return URL.create(
            drivername="postgresql+psycopg",
            username=config.username,
            password=password,
            host=config.host,
            port=config.port,
            database=config.database_name,
            query={"sslmode": "require"} if config.use_ssl else None,
        )

    if config.database_type == DatabaseType.MYSQL:
        query = {"charset": "utf8mb4"}
        if config.use_ssl:
            query["ssl_disabled"] = "false"
        return URL.create(
            drivername="mysql+mysqlconnector",
            username=config.username,
            password=password,
            host=config.host,
            port=config.port,
            database=config.database_name,
            query=query,
        )

    if config.database_type == DatabaseType.ORACLE:
        if config.service_name:
            return URL.create(
                drivername="oracle+oracledb",
                username=config.username,
                password=password,
                host=config.host,
                port=config.port,
                query={"service_name": config.service_name},
            )

        return URL.create(
            drivername="oracle+oracledb",
            username=config.username,
            password=password,
            host=config.host,
            port=config.port,
            database=config.sid,
        )

    raise DatabaseConnectionError(f"지원하지 않는 DB 유형입니다: {config.database_type}")


def create_database_engine(config: DatabaseConnectionInput) -> Engine:
    """Connection Pool 설정을 포함한 SQLAlchemy Engine을 생성합니다."""
    connect_args: dict[str, object] = {}
    if config.database_type == DatabaseType.POSTGRESQL:
        connect_args["connect_timeout"] = config.connect_timeout
    elif config.database_type == DatabaseType.MYSQL:
        connect_args["connection_timeout"] = config.connect_timeout

    return create_engine(
        build_database_url(config),
        pool_pre_ping=True,
        pool_size=config.pool_size,
        max_overflow=config.max_overflow,
        pool_recycle=1800,
        connect_args=connect_args,
    )


def test_database_connection(config: DatabaseConnectionInput) -> dict[str, str | bool | int]:
    """Engine을 만들고 DB별 간단한 테스트 SQL을 실행합니다."""
    started_at = perf_counter()
    engine = create_database_engine(config)
    test_sql = "SELECT 1 FROM DUAL" if config.database_type == DatabaseType.ORACLE else "SELECT 1"

    try:
        with engine.connect() as connection:
            connection.execute(text(test_sql))
        return {
            "success": True,
            "connection_name": config.connection_name,
            "response_time_ms": round((perf_counter() - started_at) * 1000),
            "message": "DB 연결에 성공했습니다.",
        }
    except SQLAlchemyError as error:
        raise DatabaseConnectionError(f"DB 연결에 실패했습니다: {error.__class__.__name__}") from error
    finally:
        engine.dispose()
