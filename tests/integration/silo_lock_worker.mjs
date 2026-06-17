import { parentPort, workerData } from 'node:worker_threads';
import pg from 'pg';

const { workerId, siloId, binId, ticketWeight, deposits } = workerData;

async function run() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  let successCount = 0;
  let failCount = 0;
  const errors = [];

  for (let i = 0; i < deposits; i++) {
    try {
      const client = await pool.connect();
      try {
        const bigLockValue = (BigInt(siloId) << BigInt(32)) | BigInt(binId);
        const lockValue = bigLockValue ^ BigInt('0x9E3779B97F4A7C15');

        await client.query('SELECT pg_advisory_lock($1)', [lockValue]);

        const { rows: balanceRows } = await client.query(
          'SELECT balance FROM silo_bins WHERE silo_id = $1 AND bin_id = $2 FOR UPDATE',
          [siloId, binId],
        );

        let previousBalance = 0;
        if (balanceRows.length === 0) {
          await client.query(
            'INSERT INTO silo_bins (silo_id, bin_id, balance) VALUES ($1, $2, $3)',
            [siloId, binId, ticketWeight],
          );
        } else {
          previousBalance = parseFloat(balanceRows[0].balance);
          const newBalance = previousBalance + ticketWeight;
          await client.query(
            'UPDATE silo_bins SET balance = $3, updated_at = NOW() WHERE silo_id = $1 AND bin_id = $2',
            [siloId, binId, newBalance],
          );
        }

        await client.query('SELECT pg_advisory_unlock($1)', [lockValue]);
        successCount++;
      } finally {
        client.release();
      }
    } catch (err) {
      failCount++;
      errors.push(err.message);
    }
  }

  parentPort.postMessage({ workerId, successCount, failCount, errors });
  await pool.end();
}

run();
