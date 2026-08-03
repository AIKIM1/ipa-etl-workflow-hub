-- Persistent React Flow workspace storage for IPA ETL Workflow Hub.

CREATE TABLE IF NOT EXISTS workflows (
    workflow_id VARCHAR(32) PRIMARY KEY,
    workflow_name VARCHAR(150) NOT NULL UNIQUE,
    schedule VARCHAR(255) NOT NULL DEFAULT '',
    default_success_condition TEXT NOT NULL DEFAULT 'on_success',
    default_failure_condition TEXT NOT NULL DEFAULT 'stop_workflow',
    parallel_execution BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_nodes (
    workflow_id VARCHAR(32) NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    node_id VARCHAR(120) NOT NULL,
    node_type VARCHAR(50) NOT NULL,
    component_type VARCHAR(50),
    title VARCHAR(255),
    job_code VARCHAR(100),
    status VARCHAR(30),
    connection_id VARCHAR(32),
    connection_label VARCHAR(255),
    position_x DOUBLE PRECISION NOT NULL,
    position_y DOUBLE PRECISION NOT NULL,
    origin JSON,
    node_data JSON NOT NULL,
    PRIMARY KEY (workflow_id, node_id)
);

CREATE TABLE IF NOT EXISTS workflow_edges (
    workflow_id VARCHAR(32) NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    edge_id VARCHAR(160) NOT NULL,
    source_node_id VARCHAR(120) NOT NULL,
    target_node_id VARCHAR(120) NOT NULL,
    edge_data JSON NOT NULL,
    PRIMARY KEY (workflow_id, edge_id)
);

CREATE INDEX IF NOT EXISTS idx_workflows_updated_at ON workflows (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_connection_id ON workflow_nodes (connection_id);
