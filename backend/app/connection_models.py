from enum import Enum

from pydantic import BaseModel, Field, SecretStr, model_validator


class DatabaseType(str, Enum):
    POSTGRESQL = "POSTGRESQL"
    MYSQL = "MYSQL"
    ORACLE = "ORACLE"


class ConnectionRole(str, Enum):
    SOURCE = "SOURCE"
    TARGET = "TARGET"
    AUDIT = "AUDIT"


class EnvironmentType(str, Enum):
    DEV = "DEV"
    TEST = "TEST"
    PROD = "PROD"


class DatabaseConnectionInput(BaseModel):
    connection_name: str = Field(min_length=2, max_length=100)
    database_type: DatabaseType
    host: str
    port: int = Field(gt=0, le=65535)

    # PostgreSQL/MySQL uses database_name. Oracle can use service_name or sid.
    database_name: str | None = None
    service_name: str | None = None
    sid: str | None = None

    default_schema: str | None = None
    username: str
    password: SecretStr | None = None
    password_env_key: str | None = None
    connection_role: ConnectionRole = ConnectionRole.SOURCE
    environment: EnvironmentType = EnvironmentType.DEV
    connect_timeout: int = Field(default=10, ge=1, le=120)
    pool_size: int = Field(default=5, ge=1, le=50)
    max_overflow: int = Field(default=10, ge=0, le=100)
    use_ssl: bool = False
    read_only: bool = False
    description: str | None = None

    @model_validator(mode="after")
    def validate_database_fields(self):
        if self.password is None and self.password_env_key is None:
            raise ValueError("password 또는 password_env_key 중 하나가 필요합니다.")

        if self.database_type in {DatabaseType.POSTGRESQL, DatabaseType.MYSQL} and not self.database_name:
            raise ValueError("PostgreSQL/MySQL은 database_name이 필요합니다.")

        if self.database_type == DatabaseType.ORACLE:
            if not self.service_name and not self.sid:
                raise ValueError("Oracle은 service_name 또는 sid가 필요합니다.")
            if self.service_name and self.sid:
                raise ValueError("Oracle service_name과 sid는 동시에 사용할 수 없습니다.")

        return self


class StoredConnection(BaseModel):
    connection_id: str
    status: str
    default_schema: str | None = None
    schemas: list[str] = Field(default_factory=list)
    tables: list[str] = Field(default_factory=list)
    config: DatabaseConnectionInput

    def public_dict(self) -> dict[str, object]:
        data = self.model_dump()
        data["config"].pop("password", None)
        return data
