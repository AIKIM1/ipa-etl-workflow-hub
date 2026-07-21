from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


class WorkflowDefinition(BaseModel):
    workflow_name: str
    source_connection: str
    source_table: str
    target_connection: str
    target_table: str
    load_type: Literal["Full", "Incremental"]
    watermark_column: str | None = None
    primary_key: str
    schedule: str


app = FastAPI(title="IPA ETL Workflow Hub API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/workflows")
def create_workflow(workflow: WorkflowDefinition) -> dict[str, object]:
    return {"message": "workflow accepted", "workflow": workflow.model_dump()}
