-- AgriTrust Protocol – Ledger Gap Tracking Tables
-- Tracks gaps in ledger_events for Horizon event catch-up recovery.

CREATE TABLE IF NOT EXISTS ledger_events (
  sequence BIGINT NOT NULL,
  event_index INT NOT NULL,
  transaction_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  closed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (sequence, event_index)
);

CREATE TABLE IF NOT EXISTS ledger_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  range_start BIGINT NOT NULL,
  range_end BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered', 'filling', 'filled', 'escalated')),
  retry_count INT NOT NULL DEFAULT 0,
  last_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_gap_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gap_id UUID NOT NULL REFERENCES ledger_gaps(id),
  reason TEXT NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
