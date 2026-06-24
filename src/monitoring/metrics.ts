/**
 * AgriTrust Backend – WebSocket Drain Prometheus Metrics
 *
 * Registers drain-related metrics against the unified metricsRegistry:
 *
 *   ws_drain_duration_seconds  – histogram with buckets [0.1, 0.5, 1, 5, 10, 30]
 *   ws_connections_draining    – gauge of connections currently in Draining state
 *   ws_connections_active      – gauge of connections currently Active
 *   ws_drain_total             – counter of drain events by reason
 *   ws_drain_rst_total         – counter of RST-closed (hard) disconnects
 */

import { Histogram, Gauge, Counter } from 'prom-client';
import { metricsRegistry } from '../api/metrics/registry';
import { ConnectionManager } from '../websocket/connection-manager';

// ─── Histogram ──────────────────────────────────────────────────────────────

export const wsDrainDurationSeconds = new Histogram({
  name: 'ws_drain_duration_seconds',
  help: 'Duration of WebSocket connection drain in seconds',
  buckets: [0.1, 0.5, 1, 5, 10, 30],
  registers: [metricsRegistry],
});

// ─── Gauges ─────────────────────────────────────────────────────────────────

export const wsConnectionsDraining = new Gauge({
  name: 'ws_connections_draining',
  help: 'Number of WebSocket connections currently in Draining state',
  registers: [metricsRegistry],
});

export const wsConnectionsActive = new Gauge({
  name: 'ws_connections_active',
  help: 'Number of WebSocket connections currently Active',
  registers: [metricsRegistry],
});

// ─── Counters ───────────────────────────────────────────────────────────────

export const wsDrainTotal = new Counter({
  name: 'ws_drain_total',
  help: 'Total number of drain events',
  labelNames: ['reason'] as const,
  registers: [metricsRegistry],
});

export const wsDrainRstTotal = new Counter({
  name: 'ws_drain_rst_total',
  help: 'Total number of RST-closed (hard) disconnects during drain',
  registers: [metricsRegistry],
});

// ─── Wiring ─────────────────────────────────────────────────────────────────

/**
 * Wire a ConnectionManager's drain events to the Prometheus metrics above.
 * Call once during server bootstrap.
 */
export function registerDrainMetrics(manager: ConnectionManager): void {
  const ctrl = manager.drainController;

  ctrl.on('drain_started', (_socketId: string, reason: string) => {
    wsDrainTotal.inc({ reason });
    wsConnectionsDraining.set(ctrl.getDrainingCount());
    wsConnectionsActive.set(ctrl.getActiveCount());
  });

  ctrl.on('connection_closed', (_socketId: string, info: { rst: boolean; durationMs: number }) => {
    if (info.durationMs > 0) {
      wsDrainDurationSeconds.observe(info.durationMs / 1000);
    }
    if (info.rst) {
      wsDrainRstTotal.inc();
    }
    wsConnectionsDraining.set(ctrl.getDrainingCount());
    wsConnectionsActive.set(ctrl.getActiveCount());
  });
}

/**
 * Reset all WebSocket drain metrics (for testing).
 */
export function resetDrainMetrics(): void {
  wsDrainDurationSeconds.reset();
  wsConnectionsDraining.reset();
  wsConnectionsActive.reset();
  wsDrainTotal.reset();
  wsDrainRstTotal.reset();
}
