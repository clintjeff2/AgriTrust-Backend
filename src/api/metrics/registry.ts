/**
 * AgriTrust Backend – Unified Prometheus Registry
 *
 * Aggregates every metric family (runtime, pool, ledger, HTTP middleware)
 * into a single prom-client Registry so a single GET /metrics scrape
 * returns the full picture.
 *
 * Each sub-module registers its metrics against this registry at import time,
 * so simply importing this file (or any consumer) is enough to wire everything.
 */

import { Registry } from 'prom-client';

// ─── Central registry ──────────────────────────────────────────────────────

const metricsRegistry = new Registry();

export { metricsRegistry };
