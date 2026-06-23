-- Batch Audit Log Schema
CREATE TABLE IF NOT EXISTS batch_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL,
    sequence INT NOT NULL,
    transition TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(batch_id, sequence)
);
