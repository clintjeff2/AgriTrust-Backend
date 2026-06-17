const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    project: 'Grant Stream', 
    status: 'Tracking Grants', 
    contract: 'CD6OGC46OFCV52IJQKEDVKLX5ASA3ZMSTHAAZQIPDSJV6VZ3KUJDEP4D' 
  });
});

app.get('/health/ledger-consistency', async (req, res) => {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    const result = await pool.query(
      "SELECT COUNT(*) AS count, MIN(last_attempt) AS oldest FROM ledger_gaps WHERE status IN ('discovered', 'filling')",
    );
    await pool.end();

    const count = Number(result.rows[0]?.count ?? 0);
    const oldest = result.rows[0]?.oldest;

    res.json({
      unresolvedGaps: count,
      oldestGapAgeSeconds: oldest
        ? Math.floor((Date.now() - new Date(oldest).getTime()) / 1000)
        : 0,
      healthy: count === 0,
    });
  } catch (err) {
    res.status(503).json({
      error: 'Ledger consistency check failed',
      healthy: false,
    });
  }
});

app.listen(port, () => console.log('Grant API running'));
