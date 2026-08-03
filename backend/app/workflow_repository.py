"""Persistent React Flow workspace storage in the IPA control database."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Boolean, JSON, Column, DateTime, Float, ForeignKey, Integer, MetaData, String, Table, Text, delete, func, insert, select, update

from .connection_repository import ConnectionRepositoryError, get_control_engine


class WorkflowRepositoryError(RuntimeError):
    """Raised when a workflow workspace cannot be persisted or restored."""


class WorkflowNotFoundError(WorkflowRepositoryError):
    """Raised when a workflow ID does not exist in the control database."""


metadata = MetaData()

workflows_table = Table(
    "workflows",
    metadata,
    Column("workflow_id", String(32), primary_key=True),
    Column("workflow_name", String(150), nullable=False, unique=True, index=True),
    Column("schedule", String(255), nullable=False, default=""),
    Column("default_success_condition", Text, nullable=False, default="on_success"),
    Column("default_failure_condition", Text, nullable=False, default="stop_workflow"),
    Column("parallel_execution", Boolean, nullable=False, default=False),
    Column("status", String(20), nullable=False, default="ACTIVE"),
    Column("version", Integer, nullable=False, default=1),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

workflow_nodes_table = Table(
    "workflow_nodes",
    metadata,
    Column("workflow_id", String(32), ForeignKey("workflows.workflow_id", ondelete="CASCADE"), primary_key=True),
    Column("node_id", String(120), primary_key=True),
    Column("node_type", String(50), nullable=False),
    Column("component_type", String(50)),
    Column("title", String(255)),
    Column("job_code", String(100)),
    Column("status", String(30)),
    Column("connection_id", String(32)),
    Column("connection_label", String(255)),
    Column("position_x", Float, nullable=False),
    Column("position_y", Float, nullable=False),
    Column("origin", JSON),
    Column("node_data", JSON, nullable=False),
)

workflow_edges_table = Table(
    "workflow_edges",
    metadata,
    Column("workflow_id", String(32), ForeignKey("workflows.workflow_id", ondelete="CASCADE"), primary_key=True),
    Column("edge_id", String(160), primary_key=True),
    Column("source_node_id", String(120), nullable=False),
    Column("target_node_id", String(120), nullable=False),
    Column("edge_data", JSON, nullable=False),
)


def initialize_workflow_database() -> None:
    """Creates workspace tables in the configured control PostgreSQL database."""
    try:
        metadata.create_all(get_control_engine(), tables=[workflows_table, workflow_nodes_table, workflow_edges_table])
    except ConnectionRepositoryError as error:
        raise WorkflowRepositoryError(str(error)) from error
    except Exception as error:
        raise WorkflowRepositoryError(f"Could not initialize workflow database: {error.__class__.__name__}") from error


class WorkflowRepository:
    """Stores a workflow canvas as normalized workflow, node, and edge records."""

    def create(self, payload: dict[str, object]) -> dict[str, object]:
        workflow_id = f"WF_{uuid4().hex[:8].upper()}"
        now = datetime.now(UTC)
        values = self._workflow_values(payload, now)
        values["workflow_id"] = workflow_id
        values["created_at"] = now

        try:
            with get_control_engine().begin() as connection:
                connection.execute(insert(workflows_table).values(**values))
                self._replace_canvas(connection, workflow_id, payload)
        except ConnectionRepositoryError as error:
            raise WorkflowRepositoryError(str(error)) from error
        except Exception as error:
            raise WorkflowRepositoryError(f"Could not save workflow: {error.__class__.__name__}") from error
        return self.get(workflow_id)

    def list(self) -> list[dict[str, object]]:
        node_count = func.count(func.distinct(workflow_nodes_table.c.node_id))
        edge_count = func.count(func.distinct(workflow_edges_table.c.edge_id))
        statement = (
            select(
                workflows_table,
                node_count.label("node_count"),
                edge_count.label("edge_count"),
            )
            .outerjoin(workflow_nodes_table, workflow_nodes_table.c.workflow_id == workflows_table.c.workflow_id)
            .outerjoin(workflow_edges_table, workflow_edges_table.c.workflow_id == workflows_table.c.workflow_id)
            .group_by(workflows_table.c.workflow_id)
            .order_by(workflows_table.c.updated_at.desc())
        )
        try:
            with get_control_engine().connect() as connection:
                rows = connection.execute(statement).mappings().all()
        except ConnectionRepositoryError as error:
            raise WorkflowRepositoryError(str(error)) from error
        except Exception as error:
            raise WorkflowRepositoryError(f"Could not read workflows: {error.__class__.__name__}") from error

        return [
            {
                "id": row["workflow_id"],
                "workflow_name": row["workflow_name"],
                "schedule": row["schedule"],
                "status": row["status"],
                "version": row["version"],
                "node_count": row["node_count"],
                "edge_count": row["edge_count"],
                "updated_at": row["updated_at"].isoformat(),
            }
            for row in rows
        ]

    def get(self, workflow_id: str) -> dict[str, object]:
        try:
            with get_control_engine().connect() as connection:
                workflow = connection.execute(
                    select(workflows_table).where(workflows_table.c.workflow_id == workflow_id)
                ).mappings().one_or_none()
                if workflow is None:
                    raise WorkflowNotFoundError(f"Workflow not found: {workflow_id}")
                nodes = connection.execute(
                    select(workflow_nodes_table)
                    .where(workflow_nodes_table.c.workflow_id == workflow_id)
                    .order_by(workflow_nodes_table.c.node_id)
                ).mappings().all()
                edges = connection.execute(
                    select(workflow_edges_table)
                    .where(workflow_edges_table.c.workflow_id == workflow_id)
                    .order_by(workflow_edges_table.c.edge_id)
                ).mappings().all()
        except ConnectionRepositoryError as error:
            raise WorkflowRepositoryError(str(error)) from error
        except WorkflowRepositoryError:
            raise
        except Exception as error:
            raise WorkflowRepositoryError(f"Could not read workflow: {error.__class__.__name__}") from error

        return {
            "id": workflow["workflow_id"],
            "workflow_name": workflow["workflow_name"],
            "schedule": workflow["schedule"],
            "default_success_condition": workflow["default_success_condition"],
            "default_failure_condition": workflow["default_failure_condition"],
            "parallel_execution": workflow["parallel_execution"],
            "status": workflow["status"],
            "version": workflow["version"],
            "created_at": workflow["created_at"].isoformat(),
            "updated_at": workflow["updated_at"].isoformat(),
            "nodes": [self._restore_node(row) for row in nodes],
            "edges": [dict(row["edge_data"]) for row in edges],
        }

    def update(self, workflow_id: str, payload: dict[str, object]) -> dict[str, object]:
        self.get(workflow_id)
        now = datetime.now(UTC)
        values = self._workflow_values(payload, now)
        values["version"] = workflows_table.c.version + 1
        try:
            with get_control_engine().begin() as connection:
                connection.execute(
                    update(workflows_table)
                    .where(workflows_table.c.workflow_id == workflow_id)
                    .values(**values)
                )
                self._replace_canvas(connection, workflow_id, payload)
        except ConnectionRepositoryError as error:
            raise WorkflowRepositoryError(str(error)) from error
        except Exception as error:
            raise WorkflowRepositoryError(f"Could not update workflow: {error.__class__.__name__}") from error
        return self.get(workflow_id)

    def delete(self, workflow_id: str) -> None:
        try:
            with get_control_engine().begin() as connection:
                connection.execute(delete(workflow_edges_table).where(workflow_edges_table.c.workflow_id == workflow_id))
                connection.execute(delete(workflow_nodes_table).where(workflow_nodes_table.c.workflow_id == workflow_id))
                result = connection.execute(delete(workflows_table).where(workflows_table.c.workflow_id == workflow_id))
        except ConnectionRepositoryError as error:
            raise WorkflowRepositoryError(str(error)) from error
        except Exception as error:
            raise WorkflowRepositoryError(f"Could not delete workflow: {error.__class__.__name__}") from error
        if result.rowcount == 0:
            raise WorkflowNotFoundError(f"Workflow not found: {workflow_id}")

    def _workflow_values(self, payload: dict[str, object], now: datetime) -> dict[str, object]:
        return {
            "workflow_name": payload["workflow_name"],
            "schedule": payload.get("schedule", ""),
            "default_success_condition": payload.get("default_success_condition", "on_success"),
            "default_failure_condition": payload.get("default_failure_condition", "stop_workflow"),
            "parallel_execution": payload.get("parallel_execution", False),
            "status": "ACTIVE",
            "updated_at": now,
        }

    def _replace_canvas(self, connection: object, workflow_id: str, payload: dict[str, object]) -> None:
        connection.execute(delete(workflow_edges_table).where(workflow_edges_table.c.workflow_id == workflow_id))
        connection.execute(delete(workflow_nodes_table).where(workflow_nodes_table.c.workflow_id == workflow_id))

        for node in payload.get("nodes", []):
            node_data = dict(node["data"])
            position = node["position"]
            connection_ref = node_data.get("connectionRef") if isinstance(node_data.get("connectionRef"), dict) else {}
            connection.execute(
                insert(workflow_nodes_table).values(
                    workflow_id=workflow_id,
                    node_id=node["id"],
                    node_type=node.get("type", "job"),
                    component_type=node_data.get("componentType"),
                    title=node_data.get("title"),
                    job_code=node_data.get("jobCode"),
                    status=node_data.get("status"),
                    connection_id=connection_ref.get("connectionId"),
                    connection_label=node_data.get("connectionLabel"),
                    position_x=position["x"],
                    position_y=position["y"],
                    origin=node.get("origin"),
                    node_data=node_data,
                )
            )

        for edge in payload.get("edges", []):
            edge_data = dict(edge)
            edge_id = edge_data.get("id") or f"edge-{uuid4().hex}"
            edge_data["id"] = edge_id
            connection.execute(
                insert(workflow_edges_table).values(
                    workflow_id=workflow_id,
                    edge_id=edge_id,
                    source_node_id=edge_data["source"],
                    target_node_id=edge_data["target"],
                    edge_data=edge_data,
                )
            )

    @staticmethod
    def _restore_node(row: object) -> dict[str, object]:
        return {
            "id": row["node_id"],
            "type": row["node_type"],
            "position": {"x": row["position_x"], "y": row["position_y"]},
            "origin": row["origin"],
            "data": dict(row["node_data"]),
        }
