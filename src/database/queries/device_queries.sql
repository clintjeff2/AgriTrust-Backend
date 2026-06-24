-- Device certificate lookup query
SELECT device_id, cert_serial, cert_fingerprint, revoked, expiry
FROM devices
WHERE cert_serial = $1
  AND cert_fingerprint = $2
  AND revoked = false
  AND expiry > NOW()
LIMIT 1;
