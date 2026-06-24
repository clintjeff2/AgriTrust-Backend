-- AgriTrust Protocol – Saga Orchestration Tables
-- Backs the multi-step escrow settlement coordinator (issue #43).
--
-- saga_executions : one row per saga; holds the FSM status, the definition
--                   name (so a failed saga can be reconstructed for retry)
--                   and the latest context snapshot.
-- saga_log        : append-only audit trail of every step transition.

CREATE TABLE IF NOT EXISTS saga_executions (
    saga_id     TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    tenant_id   TEXT NOT NULL DEFAULT 'default',
    status      TEXT NOT NULL,
    context     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforces the per-tenant concurrency cap lookups cheaply.
CREATE INDEX IF NOT EXISTS idx_saga_executions_tenant_status
    ON saga_executions (tenant_id, status);

CREATE TABLE IF NOT EXISTS saga_log (
    id          BIGSERIAL PRIMARY KEY,
    saga_id     TEXT NOT NULL,
    step_id     TEXT NOT NULL,
    status      TEXT NOT NULL,
    payload     JSONB,
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ordered lookups of a saga's transitions, and the "latest status per step"
-- query that backs the at-most-once retry guard.
CREATE INDEX IF NOT EXISTS idx_saga_log_saga_step
    ON saga_log (saga_id, step_id, created_at DESC, id DESC);
