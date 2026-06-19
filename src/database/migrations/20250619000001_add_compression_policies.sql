-- AgriTrust Protocol – Compression & Retention Policies for Environmental Logs
-- Applies TimescaleDB compression and retention policies after the hypertable
-- has been created via timescale_init.sql.
--
-- Compression segment-by columns (sensor_id, spatial_zone_id) are configured
-- in timescale_init.sql via ALTER TABLE SET. This migration adds only the
-- scheduled policies, which makes it idempotent and safe to re-run.

DO $$
BEGIN
    -- Verify the hypertable exists before applying policies
    IF EXISTS (
        SELECT 1
        FROM _timescaledb_catalog.hypertable
        WHERE table_name = 'environmental_logs'
    ) THEN
        -- Add compression policy (chunks older than 14 days)
        PERFORM add_compression_policy(
            'environmental_logs',
            INTERVAL '14 days',
            if_not_exists => TRUE
        );

        -- Add retention policy (chunks older than 365 days)
        PERFORM add_retention_policy(
            'environmental_logs',
            INTERVAL '365 days',
            if_not_exists => TRUE
        );
    ELSE
        RAISE NOTICE 'Hypertable environmental_logs does not exist. Run timescale_init.sql first.';
    END IF;
END
$$;
