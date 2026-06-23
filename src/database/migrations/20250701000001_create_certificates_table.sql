-- AgriTrust Protocol – Certificates Table
-- Stores minted NFT certificate references for certified batches.
-- Unique constraint on batch_id prevents duplicate mints at the DB level.

CREATE TABLE IF NOT EXISTS certificates (
    id              BIGSERIAL PRIMARY KEY,
    batch_id        TEXT NOT NULL UNIQUE,
    certificate_id  TEXT,
    status          TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
