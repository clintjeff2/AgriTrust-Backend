-- AgriTrust Protocol – Event Sourcing Event Store (issue #42)
--
-- events    : append-only, immutable audit trail of aggregate state changes.
--             Global ordering via BIGSERIAL; per-stream ordering via
--             (stream_id, stream_version) which is also the optimistic
--             concurrency guard. Archived events retain a cold-storage pointer
--             while their JSONB payload is cleared.
-- snapshots : compressed point-in-time folds, written every N events so
--             rehydration can skip replaying full history.

CREATE TABLE IF NOT EXISTS events (
    global_seq        BIGSERIAL PRIMARY KEY,
    stream_id         UUID NOT NULL,
    stream_version    INT NOT NULL,
    event_type        VARCHAR(128) NOT NULL,
    data              JSONB NOT NULL,
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cold_storage_key  TEXT,
    archived_at       TIMESTAMPTZ,
    CONSTRAINT uq_events_stream_version UNIQUE (stream_id, stream_version)
);

-- Primary read path: events for a stream in version order.
CREATE INDEX IF NOT EXISTS idx_events_stream
    ON events (stream_id, stream_version);

-- Archival scan: oldest un-archived events first.
CREATE INDEX IF NOT EXISTS idx_events_created_at
    ON events (created_at)
    WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS snapshots (
    stream_id   UUID NOT NULL,
    version     INT NOT NULL,
    snapshot    BYTEA NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (stream_id, version)
);

-- Latest-snapshot lookup per stream.
CREATE INDEX IF NOT EXISTS idx_snapshots_latest
    ON snapshots (stream_id, version DESC);
