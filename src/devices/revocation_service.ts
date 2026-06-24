import { Pool } from 'pg';

const SELECT_REVOKED_SERIALS = `
SELECT serial
FROM cert_revocations
`;

const INSERT_REVOCATION = `
INSERT INTO cert_revocations (serial, reason)
VALUES ($1, $2)
ON CONFLICT (serial) DO NOTHING
`;

const UPDATE_DEVICE_REVOKED = `
UPDATE devices
SET revoked = true,
    updated_at = NOW()
WHERE cert_serial = $1
`;

export class CertificateRevocationService {
  constructor(private readonly pool: Pool) {}

  async refreshCrl(): Promise<string[]> {
    const result = await this.pool.query<{ serial: string }>(SELECT_REVOKED_SERIALS);
    return result.rows.map((row) => row.serial);
  }

  async revokeSerial(serialHex: string, reason: string): Promise<void> {
    await this.pool.query('BEGIN');
    try {
      await this.pool.query(INSERT_REVOCATION, [serialHex, reason]);
      await this.pool.query(UPDATE_DEVICE_REVOKED, [serialHex]);
      await this.pool.query('COMMIT');
    } catch (err) {
      await this.pool.query('ROLLBACK');
      throw err;
    }
  }
}
