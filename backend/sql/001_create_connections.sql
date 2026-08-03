-- IPA ETL Workflow Hub control database schema (PostgreSQL)
-- Set CONTROL_DATABASE_URL to this database; do not use an ETL source/target DB.

CREATE TABLE IF NOT EXISTS connections (
    connection_id VARCHAR(32) PRIMARY KEY,
    connection_name VARCHAR(100) NOT NULL UNIQUE,
    database_type VARCHAR(20) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL,
    database_name VARCHAR(255),
    service_name VARCHAR(255),
    sid VARCHAR(255),
    default_schema VARCHAR(255),
    username VARCHAR(255) NOT NULL,
    encrypted_password TEXT,
    password_env_key VARCHAR(255),
    connection_role VARCHAR(20) NOT NULL,
    environment VARCHAR(20) NOT NULL,
    connect_timeout INTEGER NOT NULL DEFAULT 10,
    pool_size INTEGER NOT NULL DEFAULT 5,
    max_overflow INTEGER NOT NULL DEFAULT 10,
    use_ssl BOOLEAN NOT NULL DEFAULT FALSE,
    read_only BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    schemas JSON NOT NULL DEFAULT '[]'::json,
    tables JSON NOT NULL DEFAULT '[]'::json,
    last_tested_at TIMESTAMPTZ,
    last_response_time_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT connections_secret_check CHECK (encrypted_password IS NOT NULL OR password_env_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_connections_environment ON connections (environment);
CREATE INDEX IF NOT EXISTS idx_connections_status ON connections (status);
