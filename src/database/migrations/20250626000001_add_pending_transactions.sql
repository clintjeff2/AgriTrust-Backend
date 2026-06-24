-- AgriTrust Protocol – Two-Phase Commit Pending Transactions Table
-- Backs the TransactionCoordinator (issue #13).
--
-- pending_transactions : one row per tentative state change; holds the
--   before/after snapshots, the Soroban hash (once submitted), and a
--   timeout deadline so the recovery worker can auto-rollback stale entries.

CREATE TABLE IF NOT EXISTS pending_transactions (
    tx_uuid         UUID PRIMARY KEY,
    cargo_id        UUID NOT NULL,
    operation_type  TEXT NOT NULL,
    before_state    JSONB NOT NULL,
    after_state     JSONB NOT NULL,
    soroban_hash    TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    timeout_at      TIMESTAMPTZ NOT NULL
);

-- Fast lookup of pending rows for a given cargo, used to enforce the
-- sequential-processing invariant (no overlapping transactions per cargo).
CREATE INDEX IF NOT EXISTS idx_pending_tx_cargo_pending
    ON pending_transactions (cargo_id)
    WHERE status = 'pending';

-- The recovery worker scans for timed-out pending rows every 10 seconds.
CREATE INDEX IF NOT EXISTS idx_pending_tx_timeout
    ON pending_transactions (status, timeout_at)
    WHERE status = 'pending';
