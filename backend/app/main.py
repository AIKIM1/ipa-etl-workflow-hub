from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .connection_factory import DatabaseConnectionError, test_database_connection
from .connection_models import DatabaseConnectionInput, StoredConnection
from .connection_repository import (
    ConnectionNotFoundError,
    ConnectionRepository,
    ConnectionRepositoryError,
    initialize_control_database,
)
from .metadata_service import get_database_metadata, get_table_columns
from .template_generator import generate_connection_template


ComponentType = Literal[
    "source-extract",
    "data-cleaning",
    "target-load",
    "quality-check",
    "custom-transform",
]
LoadType = Literal["Full", "Incremental"]


class JobDefinition(BaseModel):
    """독립 실행·재사용 단위입니다. Workflow는 이 정의를 복제하지 않고 job_id로 참조합니다."""

    name: str
    description: str = ""
    component_type: ComponentType
    source_connection_id: str | None = None
    target_connection_id: str | None = None
    processing_code: str = ""
    input_contract: str = ""
    output_contract: str = ""
    retry_count: int = Field(default=0, ge=0, le=10)
    version: str = "1.0.0"
    config: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class StoredJob(JobDefinition):
    id: str
    status: Literal["ready", "running", "stopped", "disabled"] = "ready"
    created_at: datetime


class WorkflowJobLink(BaseModel):
    """Workflow 안에서의 Job 실행 조건과 의존 관계만 보관합니다."""

    job_id: str
    depends_on: list[str] = Field(default_factory=list)
    success_condition: str = "on_success"
    failure_condition: str = "stop_workflow"
    parallel_group: str | None = None


class WorkflowDefinition(BaseModel):
    """Job 조립 정보입니다. DB 접속정보와 처리 코드는 Job 정의에만 존재합니다."""

    workflow_name: str
    job_ids: list[str] = Field(default_factory=list)
    job_links: list[WorkflowJobLink] = Field(default_factory=list)
    schedule: str = ""
    default_success_condition: str = "on_success"
    default_failure_condition: str = "stop_workflow"
    parallel_execution: bool = False


class StoredWorkflow(WorkflowDefinition):
    id: str
    created_at: datetime


class ConnectionRegistry:
    """DB 접속정보를 등록하고 connection_id로 다른 컴포넌트가 재사용하게 합니다."""

    def __init__(self) -> None:
        self._connections: dict[str, StoredConnection] = {}

    def add(self, payload: DatabaseConnectionInput, status: str = "REGISTERED") -> StoredConnection:
        metadata = {
            "default_schema": payload.default_schema,
            "schemas": [payload.default_schema] if payload.default_schema else [],
            "tables": [],
        }
        connection = StoredConnection(
            connection_id=f"CONN_{uuid4().hex[:8].upper()}",
            status=status,
            config=payload,
            **metadata,
        )
        self._connections[connection.connection_id] = connection
        return connection

    def list(self) -> list[StoredConnection]:
        return list(self._connections.values())

    def get(self, connection_id: str) -> StoredConnection:
        try:
            return self._connections[connection_id]
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="connection not found") from exc

    def update_metadata(self, connection_id: str, metadata: dict[str, object], status: str) -> StoredConnection:
        connection = self.get(connection_id)
        connection.status = status
        connection.default_schema = metadata.get("default_schema") if isinstance(metadata.get("default_schema"), str) else connection.default_schema
        connection.schemas = metadata.get("schemas") if isinstance(metadata.get("schemas"), list) else connection.schemas
        connection.tables = metadata.get("tables") if isinstance(metadata.get("tables"), list) else connection.tables
        return connection


class JobRegistry:
    """Job은 Workflow보다 먼저 만들어지고 connection_id만 참조합니다."""

    def __init__(self, connections: ConnectionRepository) -> None:
        self._jobs: dict[str, StoredJob] = {}
        self._connections = connections

    def add(self, payload: JobDefinition) -> StoredJob:
        if payload.source_connection_id:
            self._connections.get(payload.source_connection_id)
        if payload.target_connection_id:
            self._connections.get(payload.target_connection_id)

        job = StoredJob(
            id=f"JOB_{uuid4().hex[:8].upper()}",
            created_at=datetime.now(UTC),
            **payload.model_dump(),
        )
        self._jobs[job.id] = job
        return job

    def list(self) -> list[StoredJob]:
        return list(self._jobs.values())

    def get(self, job_id: str) -> StoredJob:
        try:
            return self._jobs[job_id]
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc


class WorkflowRegistry:
    def __init__(self, jobs: JobRegistry) -> None:
        self._workflows: dict[str, StoredWorkflow] = {}
        self._jobs = jobs

    def add(self, payload: WorkflowDefinition) -> StoredWorkflow:
        linked_job_ids = [link.job_id for link in payload.job_links]
        job_ids = list(dict.fromkeys([*payload.job_ids, *linked_job_ids]))
        if not job_ids:
            raise HTTPException(status_code=422, detail="workflow requires at least one job")
        if len(job_ids) != len([*payload.job_ids, *linked_job_ids]):
            raise HTTPException(status_code=422, detail="workflow cannot contain duplicate jobs")

        for job_id in job_ids:
            self._jobs.get(job_id)
        for link in payload.job_links:
            for dependency_id in link.depends_on:
                if dependency_id not in job_ids:
                    raise HTTPException(status_code=422, detail=f"dependency job not found in workflow: {dependency_id}")

        workflow = StoredWorkflow(
            id=f"WF_{uuid4().hex[:8].upper()}",
            created_at=datetime.now(UTC),
            **payload.model_copy(update={"job_ids": job_ids}).model_dump(),
        )
        self._workflows[workflow.id] = workflow
        return workflow

    def list(self) -> list[StoredWorkflow]:
        return list(self._workflows.values())


connection_repository = ConnectionRepository()
job_registry = JobRegistry(connection_repository)
workflow_registry = WorkflowRegistry(job_registry)

app = FastAPI(title="IPA ETL Workflow Hub API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def initialize_connection_repository() -> None:
    """Create the control DB table when CONTROL_DATABASE_URL is configured."""
    try:
        initialize_control_database()
    except ConnectionRepositoryError:
        # Repository APIs return a clear configuration error until PostgreSQL is configured.
        pass


def repository_http_error(error: ConnectionRepositoryError) -> HTTPException:
    status_code = 404 if isinstance(error, ConnectionNotFoundError) else 503
    return HTTPException(status_code=status_code, detail=str(error))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/connections/test")
def test_connection(payload: DatabaseConnectionInput) -> dict[str, object]:
    """저장 전 입력값으로 일회성 연결 테스트를 실행합니다."""
    try:
        return test_database_connection(payload)
    except DatabaseConnectionError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/connections")
def create_connection(payload: DatabaseConnectionInput) -> dict[str, object]:
    """DB 접속정보를 등록하고 connection_id를 발급합니다."""
    try:
        test_result = test_database_connection(payload)
        connection = connection_repository.create(payload, test_result)
        return connection.public_dict()
    except DatabaseConnectionError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ConnectionRepositoryError as error:
        raise repository_http_error(error) from error


@app.get("/api/connections")
def list_connections() -> list[dict[str, object]]:
    try:
        return [connection.public_dict() for connection in connection_repository.list()]
    except ConnectionRepositoryError as error:
        raise repository_http_error(error) from error


@app.get("/api/connections/{connection_id}")
def get_connection(connection_id: str) -> dict[str, object]:
    try:
        return connection_repository.get(connection_id).public_dict()
    except ConnectionRepositoryError as error:
        raise repository_http_error(error) from error


@app.put("/api/connections/{connection_id}")
def update_connection(connection_id: str, payload: DatabaseConnectionInput) -> dict[str, object]:
    try:
        test_result = test_database_connection(payload)
        return connection_repository.update(connection_id, payload, test_result).public_dict()
    except DatabaseConnectionError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ConnectionRepositoryError as error:
        raise repository_http_error(error) from error


@app.delete("/api/connections/{connection_id}", status_code=204)
def delete_connection(connection_id: str) -> None:
    try:
        connection_repository.delete(connection_id)
    except ConnectionRepositoryError as error:
        raise repository_http_error(error) from error


@app.post("/api/connections/{connection_id}/metadata")
def refresh_connection_metadata(connection_id: str) -> dict[str, object]:
    try:
        connection = connection_repository.get(connection_id)
        metadata = get_database_metadata(connection.config)
        updated = connection_repository.update_metadata(connection_id, metadata, status="ACTIVE")
        return updated.public_dict()
    except DatabaseConnectionError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ConnectionRepositoryError as error:
        raise repository_http_error(error) from error


@app.get("/api/connections/{connection_id}/schemas")
def list_schemas(connection_id: str) -> dict[str, object]:
    try:
        connection = connection_repository.get(connection_id)
        return {"connection_id": connection_id, "schemas": connection.schemas}
    except ConnectionRepositoryError as error:
        raise repository_http_error(error) from error


@app.get("/api/connections/{connection_id}/tables")
def list_tables(connection_id: str) -> dict[str, object]:
    try:
        connection = connection_repository.get(connection_id)
        return {"connection_id": connection_id, "tables": connection.tables}
    except ConnectionRepositoryError as error:
        raise repository_http_error(error) from error


@app.get("/api/connections/{connection_id}/tables/{schema_name}/{table_name}/columns")
def list_columns(connection_id: str, schema_name: str, table_name: str) -> dict[str, object]:
    try:
        connection = connection_repository.get(connection_id)
        columns = get_table_columns(connection.config, schema_name=schema_name, table_name=table_name)
        return {"connection_id": connection_id, "schema": schema_name, "table": table_name, "columns": columns}
    except DatabaseConnectionError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ConnectionRepositoryError as error:
        raise repository_http_error(error) from error


@app.get("/api/connections/{connection_id}/template")
def get_connection_template(connection_id: str) -> dict[str, str]:
    try:
      connection = connection_repository.get(connection_id)
      template = generate_connection_template(connection.config)
    except ValueError as error:
      raise HTTPException(status_code=400, detail=str(error)) from error
    except ConnectionRepositoryError as error:
      raise repository_http_error(error) from error
    return {"connection_id": connection_id, "template": template}


@app.post("/api/jobs")
def create_job(payload: JobDefinition) -> StoredJob:
    return job_registry.add(payload)


@app.get("/api/jobs")
def list_jobs() -> list[StoredJob]:
    return job_registry.list()


@app.post("/api/workflows")
def create_workflow(workflow: WorkflowDefinition) -> StoredWorkflow:
    return workflow_registry.add(workflow)


@app.get("/api/workflows")
def list_workflows() -> list[StoredWorkflow]:
    return workflow_registry.list()


# Backward-compatible routes kept for the first screen prototype.
@app.post("/connections")
def create_connection_legacy(payload: DatabaseConnectionInput) -> dict[str, object]:
    return create_connection(payload)


@app.get("/connections")
def list_connections_legacy() -> list[dict[str, object]]:
    return list_connections()


@app.post("/jobs")
def create_job_legacy(payload: JobDefinition) -> StoredJob:
    return create_job(payload)


@app.get("/jobs")
def list_jobs_legacy() -> list[StoredJob]:
    return list_jobs()


@app.post("/workflows")
def create_workflow_legacy(workflow: WorkflowDefinition) -> StoredWorkflow:
    return create_workflow(workflow)


@app.get("/workflows")
def list_workflows_legacy() -> list[StoredWorkflow]:
    return list_workflows()
