-- AgriTrust Protocol – Advisory Lock Hash Function
-- Provides a well-distributed 64-bit key for pg_advisory_lock / pg_advisory_unlock
-- based on the (silo_id, bin_id) composite.

CREATE OR REPLACE FUNCTION hashSiloBin(silo_id BIGINT, bin_id BIGINT)
RETURNS BIGINT
LANGUAGE SQL
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT ((silo_id::bigint << 32) | bin_id::bigint) # 0x9E3779B97F4A7C15;
$$;
