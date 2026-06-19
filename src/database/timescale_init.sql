-- AgriTrust Protocol – TimescaleDB Dynamic Partition Sharding
-- Converts environmental_logs into a TimescaleDB hypertable with
-- 6-hour chunk intervals, spatial zone partitioning, native compression,
-- and automated retention policies.

-- ============================================================
-- 1. Create the environmental_logs table
-- ============================================================
CREATE TABLE IF NOT EXISTS environmental_logs (
    id              BIGSERIAL,
    sensor_id       UUID NOT NULL,
    timestamp       TIMESTAMPTZ NOT NULL,
    soil_moisture   FLOAT8 NOT NULL,
    soil_ph         FLOAT8 NOT NULL,
    ambient_temp     FLOAT8 NOT NULL,
    humidity        FLOAT8 NOT NULL,
    solar_radiation FLOAT8 NOT NULL,
    spatial_zone_id INT4 NOT NULL,
    PRIMARY KEY (id, timestamp)
);

-- ============================================================
-- 2. Convert to hypertable – 6-hour chunk intervals
-- ============================================================
SELECT create_hypertable(
    'environmental_logs',
    'timestamp',
    chunk_time_interval => INTERVAL '6 hours',
    if_not_exists => TRUE
);

-- ============================================================
-- 3. Add spatial dimension – 16 partitions by zone
-- ============================================================
SELECT add_dimension(
    'environmental_logs',
    'spatial_zone_id',
    number_partitions => 16,
    if_not_exists => TRUE
);

-- ============================================================
-- 4. Enable native compression
-- ============================================================
ALTER TABLE environmental_logs SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id, spatial_zone_id'
);

-- ============================================================
-- 5. Compression policy – compress chunks older than 14 days
-- ============================================================
SELECT add_compression_policy(
    'environmental_logs',
    INTERVAL '14 days',
    if_not_exists => TRUE
);

-- ============================================================
-- 6. Retention policy – drop chunks older than 365 days
-- ============================================================
SELECT add_retention_policy(
    'environmental_logs',
    INTERVAL '365 days',
    if_not_exists => TRUE
);
