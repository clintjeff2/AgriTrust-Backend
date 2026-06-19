-- AgriTrust Protocol – Environmental Logs Analytical Query Templates
-- These queries leverage TimescaleDB hypertable partitioning and compression
-- for fast time-range aggregations across farms and sensors.

-- ============================================================
-- Query 1: 7-day rolling average per sensor
-- ============================================================
-- Expected performance: < 2 seconds on 100M+ row datasets
-- Returns hourly averages for the last 7 days per sensor
SELECT
    sensor_id,
    time_bucket('1 hour', timestamp) AS bucket,
    AVG(soil_moisture)  AS avg_soil_moisture,
    AVG(soil_ph)        AS avg_soil_ph,
    AVG(ambient_temp)   AS avg_ambient_temp,
    AVG(humidity)       AS avg_humidity,
    AVG(solar_radiation) AS avg_solar_radiation
FROM environmental_logs
WHERE timestamp >= NOW() - INTERVAL '7 days'
GROUP BY sensor_id, bucket
ORDER BY sensor_id, bucket;

-- ============================================================
-- Query 2: Zone-level daily aggregates
-- ============================================================
-- Aggregates all sensors within a spatial zone for daily rollups
SELECT
    spatial_zone_id,
    time_bucket('1 day', timestamp) AS day,
    COUNT(*)                                           AS reading_count,
    AVG(soil_moisture)                                 AS avg_soil_moisture,
    AVG(ambient_temp)                                  AS avg_ambient_temp,
    AVG(humidity)                                      AS avg_humidity,
    AVG(solar_radiation)                               AS avg_solar_radiation,
    MIN(soil_moisture)                                 AS min_soil_moisture,
    MAX(soil_moisture)                                 AS max_soil_moisture
FROM environmental_logs
WHERE timestamp >= NOW() - INTERVAL '30 days'
GROUP BY spatial_zone_id, day
ORDER BY spatial_zone_id, day DESC;

-- ============================================================
-- Query 3: Latest reading per sensor (point-in-time)
-- ============================================================
-- Efficient last-point query using DISTINCT ON and the hypertable index
SELECT DISTINCT ON (sensor_id)
    sensor_id,
    timestamp,
    soil_moisture,
    soil_ph,
    ambient_temp,
    humidity,
    solar_radiation,
    spatial_zone_id
FROM environmental_logs
ORDER BY sensor_id, timestamp DESC;

-- ============================================================
-- Query 4: Compression stats (admin / diagnostics)
-- ============================================================
SELECT
    hypertable_name,
    chunk_name,
    compression_status,
    before_compression_table_bytes,
    after_compression_table_bytes,
    (before_compression_table_bytes - after_compression_table_bytes) * 100.0
        / NULLIF(before_compression_table_bytes, 0) AS compression_ratio_pct
FROM timescaledb_information.compressed_chunk_stats
WHERE hypertable_name = 'environmental_logs'
ORDER BY chunk_name;
