from sqlalchemy import inspect

from .connection_factory import create_database_engine
from .connection_models import DatabaseConnectionInput


def get_database_metadata(config: DatabaseConnectionInput) -> dict[str, object]:
    """DB 연결로부터 schema/table 목록을 조회합니다."""
    engine = create_database_engine(config)

    try:
        inspector = inspect(engine)
        schemas = inspector.get_schema_names()
        default_schema = config.default_schema or inspector.default_schema_name
        tables = inspector.get_table_names(schema=default_schema) if default_schema else inspector.get_table_names()

        return {
            "default_schema": default_schema,
            "schemas": schemas,
            "tables": tables,
        }
    finally:
        engine.dispose()


def get_table_columns(
    config: DatabaseConnectionInput,
    schema_name: str,
    table_name: str,
) -> list[dict[str, object]]:
    """특정 테이블의 컬럼 정보를 조회합니다."""
    engine = create_database_engine(config)

    try:
        inspector = inspect(engine)
        columns = inspector.get_columns(table_name=table_name, schema=schema_name)
        return [
            {
                "name": column["name"],
                "type": str(column["type"]),
                "nullable": column.get("nullable", True),
            }
            for column in columns
        ]
    finally:
        engine.dispose()
