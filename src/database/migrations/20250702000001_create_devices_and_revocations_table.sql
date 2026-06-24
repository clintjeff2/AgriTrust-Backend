-- AgriTrust Protocol – Devices and Certificate Revocation Tables

CREATE TABLE IF NOT EXISTS devices (
    device_id       TEXT PRIMARY KEY,
    cert_serial     TEXT NOT NULL UNIQUE,
    cert_fingerprint TEXT NOT NULL UNIQUE,
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    expiry          TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cert_revocations (
    serial          TEXT PRIMARY KEY,
    reason          TEXT,
    revoked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
