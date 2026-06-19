const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

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

/**
 * GET /metrics/runtime
 *
 * Returns runtime-level Prometheus metrics (event loop lag, heap, thread contention).
 * This endpoint does not require a database connection and is safe for
 * external scrape targets (every 15 s).
 *
 * In development (ts-node) the module lives at ./src/api/metrics/runtime_metrics.ts.
 * In production (after `npm run build`) the compiled output is at
 * ./dist/src/api/metrics/runtime_metrics.js.
 */
app.get('/metrics/runtime', async (_req, res) => {
  try {
    let runtimeMetrics;
    try {
      runtimeMetrics = require('./src/api/metrics/runtime_metrics');
    } catch {
      // Fall back to compiled output for production builds
      runtimeMetrics = require('./dist/src/api/metrics/runtime_metrics');
    }

    const { getRuntimeMetricsText, startCollecting } = runtimeMetrics;

    // Ensure the background collector is running
    startCollecting();

    const metrics = await getRuntimeMetricsText();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(metrics);
  } catch (err) {
    console.error('Failed to scrape runtime metrics:', err);
    res.status(500).send('# Error collecting runtime metrics\n');
  }
});

app.listen(port, () => console.log('Grant API running'));
