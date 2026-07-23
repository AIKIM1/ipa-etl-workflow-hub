import re

from .connection_models import DatabaseConnectionInput


_VALID_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{1,99}$")


def python_literal(value: str | None) -> str:
    return repr(value)


def generate_connection_template(config: DatabaseConnectionInput) -> str:
    """연결별 Python 모듈 템플릿을 문자열로 생성합니다."""
    if not _VALID_NAME.fullmatch(config.connection_name):
        raise ValueError("connection_name은 영문, 숫자, 밑줄만 사용할 수 있습니다.")

    if not config.password_env_key:
        raise ValueError("Python 템플릿 생성에는 password_env_key가 필요합니다.")

    return f'''from app.connection_factory import create_database_engine
from app.connection_models import ConnectionRole, DatabaseConnectionInput, DatabaseType, EnvironmentType


connection_config = DatabaseConnectionInput(
    connection_name="{config.connection_name}",
    database_type=DatabaseType.{config.database_type.name},
    host="{config.host}",
    port={config.port},
    database_name={python_literal(config.database_name)},
    service_name={python_literal(config.service_name)},
    sid={python_literal(config.sid)},
    default_schema={python_literal(config.default_schema)},
    username="{config.username}",
    password_env_key="{config.password_env_key}",
    connection_role=ConnectionRole.{config.connection_role.name},
    environment=EnvironmentType.{config.environment.name},
    connect_timeout={config.connect_timeout},
    pool_size={config.pool_size},
    max_overflow={config.max_overflow},
    use_ssl={config.use_ssl},
    read_only={config.read_only},
)


def get_engine():
    # Workflow/Job 컴포넌트는 이 Engine을 재사용해 DB에 접근합니다.
    return create_database_engine(connection_config)
'''
