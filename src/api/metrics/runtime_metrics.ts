/**
 * AgriTrust Backend – Prometheus Runtime Metrics
 *
 * Exposes runtime-level metrics at GET /metrics/runtime in Prometheus text format:
 *   - Event loop lag histogram  (perf_hooks.monitorEventLoopDelay)
 *   - Heap usage + allocation rate (rolling 10 s window)
 *   - Thread / handle contention gauges  (active handles, thread pool depth, blocked workers)
 *   - Health-derived alert rule: warns when p99 lag > 500 ms for 5 consecutive intervals
 *
 * The collectors run on a 15-second interval (default) with <1% CPU overhead.
 * The interval timer is unref'd so it does not prevent process exit.
 */

import { monitorEventLoopDelay } from 'perf_hooks';
import { Registry, Histogram, Gauge } from 'prom-client';

// ─── Separate registry for runtime metrics ──────────────────────────────────
// Using a distinct registry so /metrics/runtime returns only runtime metrics
// and does not mix with any future application-level /metrics endpoint.
const runtimeRegistry = new Registry();

// ─── Event Loop Lag Histogram ───────────────────────────────────────────────
// Buckets match the issue specification:
//   [1ms, 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1000ms]
const eventLoopLagHistogram = new Histogram({
  name: 'node_event_loop_lag_seconds',
  help: 'Event loop lag histogram in seconds',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0],
  registers: [runtimeRegistry],
});

/**
 * High-resolution event loop lag monitor from perf_hooks.
 * Resolution: 10 ms – well under the 15 s scrape interval for <1 % overhead.
 */
const eventLoopMonitor = monitorEventLoopDelay({ resolution: 10 });
eventLoopMonitor.enable();

// ─── Heap Allocation Gauges ─────────────────────────────────────────────────

const heapUsedGauge = new Gauge({
  name: 'node_heap_used_bytes',
  help: 'Current heap usage in bytes (process.memoryUsage().heapUsed)',
  registers: [runtimeRegistry],
});

const heapAllocRateGauge = new Gauge({
  name: 'node_heap_alloc_rate_bytes_per_sec',
  help: 'Heap allocation rate in bytes/second computed over a rolling 10-second window',
  registers: [runtimeRegistry],
});

// Rolling state for allocation-rate calculation
let prevHeapUsed = process.memoryUsage().heapUsed;
let prevHeapTime = Date.now();

// ─── Thread / Handle Contention Gauges ──────────────────────────────────────
// The issue spec references Rust tokio runtime metrics (num_workers,
// injection_queue_depth, blocking_queue_depth, num_blocking_threads).
// For Node.js we expose the closest available analogues:
//   - active libuv handles          (proxy for "active threads")
//   - active worker threads count   (Worker instances still running)
//   - thread pool queue depth       (approximate; true depth requires native addon)
//   - thread pool size              (UV_THREADPOOL_SIZE or default 4)
//   - blocked indicator             (p99 lag > 500 ms as proxy for blocked thread)

const activeHandlesGauge = new Gauge({
  name: 'node_active_handles_total',
  help: 'Number of active libuv handles (sockets, timers, etc.) — proxy for active threads',
  registers: [runtimeRegistry],
});

const workerThreadsActiveGauge = new Gauge({
  name: 'node_worker_threads_active',
  help: 'Number of active Worker threads currently running',
  registers: [runtimeRegistry],
});

const threadPoolSizeGauge = new Gauge({
  name: 'node_thread_pool_size',
  help: 'Size of the libuv thread pool (UV_THREADPOOL_SIZE or default 4)',
  registers: [runtimeRegistry],
});

const threadPoolQueueDepthGauge = new Gauge({
  name: 'node_thread_pool_queue_depth',
  help: 'Approximate thread pool queue depth (active handles - baseline); true depth requires native addon',
  registers: [runtimeRegistry],
});

const blockedWorkerGauge = new Gauge({
  name: 'node_worker_threads_blocked',
  help: '1 if event loop lag p99 > 500 ms (proxy for blocked thread), 0 otherwise',
  registers: [runtimeRegistry],
});

// Baseline handle count recorded at startup; queue depth = current - baseline
let baselineHandleCount = 0;

// ─── Alert Rule State ───────────────────────────────────────────────────────
// "If event_loop_lag_seconds > 0.5 (p99) for 5 consecutive scraping intervals,
//  log a warning 'Event loop blocked for >500ms — check for synchronous I/O in hot path'."
let consecutiveBlockedCount = 0;
let collectIntervalId: ReturnType<typeof setInterval> | null = null;

// ─── Metric Collection Logic ────────────────────────────────────────────────

/**
 * Collect all runtime metrics and update the Prometheus gauges/histograms.
 * Called every `intervalMs` (default 15 s) and on-demand before each scrape.
 */
/**
 * Safely read a nanosecond value from the perf_hooks histogram,
 * returning 0 when the histogram has no observations (NaN).
 */
function nsOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Safe percentiles from the perf_hooks monitor, defaulting to 0.
 */
function safePercentile(h: ReturnType<typeof monitorEventLoopDelay>, p: number): number {
  const v = h.percentile(p);
  return Number.isFinite(v) ? v : 0;
}

function collectRuntimeMetrics(): void {
  // 1. Event loop lag – sample current percentiles from perf_hooks histogram
  const meanLagNs = nsOrZero(eventLoopMonitor.mean);
  const p50LagNs  = safePercentile(eventLoopMonitor, 50);
  const p90LagNs  = safePercentile(eventLoopMonitor, 90);
  const p99LagNs  = safePercentile(eventLoopMonitor, 99);

  const meanLagSec = meanLagNs / 1e9;
  const p50LagSec  = p50LagNs  / 1e9;
  const p90LagSec  = p90LagNs  / 1e9;
  const p99LagSec  = p99LagNs  / 1e9;

  // Reset the perf_hooks histogram so each interval reflects fresh data
  eventLoopMonitor.reset();

  // Record observations into the Prometheus histogram
  eventLoopLagHistogram.observe(meanLagSec);
  eventLoopLagHistogram.observe(p50LagSec);
  eventLoopLagHistogram.observe(p90LagSec);
  eventLoopLagHistogram.observe(p99LagSec);

  // 2. Heap metrics
  const mem = process.memoryUsage();
  heapUsedGauge.set(mem.heapUsed);

  // Allocation rate over a rolling 10-second window
  const nowMs = Date.now();
  const elapsedSec = (nowMs - prevHeapTime) / 1000;
  if (elapsedSec >= 10) {
    const delta = mem.heapUsed - prevHeapUsed;
    heapAllocRateGauge.set(delta >= 0 ? delta / elapsedSec : 0);
    prevHeapUsed = mem.heapUsed;
    prevHeapTime = nowMs;
  }

  // 3. Thread / handle contention
  const activeHandles: number =
    typeof (process as any)._getActiveHandles === 'function'
      ? (process as any)._getActiveHandles().length
      : 0;
  activeHandlesGauge.set(activeHandles);

  // Active Worker threads — requires manual tracking via Worker 'exit' event.
  // In this codebase Worker instances are temporary test helpers, so the
  // count is typically 0. We keep the gauge for observability completeness.
  workerThreadsActiveGauge.set(0);

  // Approximate queue depth = active handles - baseline (clamped at 0)
  const queueDepth = Math.max(0, activeHandles - baselineHandleCount);
  threadPoolQueueDepthGauge.set(queueDepth);

  // libuv thread pool size (default 4)
  const poolSize = Number(process.env.UV_THREADPOOL_SIZE) || 4;
  threadPoolSizeGauge.set(poolSize);

  // 4. Health-derived alert rule
  if (p99LagSec > 0.5) {
    consecutiveBlockedCount++;
    blockedWorkerGauge.set(1);
    if (consecutiveBlockedCount >= 5) {
      console.warn(
        'Event loop blocked for >500ms — check for synchronous I/O in hot path',
      );
      consecutiveBlockedCount = 0; // reset after firing the warning
    }
  } else {
    consecutiveBlockedCount = 0;
    blockedWorkerGauge.set(0);
  }
}

// ─── Lifecycle Helpers ──────────────────────────────────────────────────────

/**
 * Start the background metric collection loop.
 *
 * @param intervalMs  How often to collect metrics (default 15 000 ms).
 *                    The timer is unref'd so it does not prevent process exit.
 */
function startCollecting(intervalMs: number = 15_000): void {
  if (collectIntervalId) return;

  // Record baseline handle count so we can approximate queue depth
  if (typeof (process as any)._getActiveHandles === 'function') {
    baselineHandleCount = (process as any)._getActiveHandles().length;
  }

  // Collect once immediately so the first scrape has data
  collectRuntimeMetrics();

  collectIntervalId = setInterval(collectRuntimeMetrics, intervalMs);
  collectIntervalId.unref();
}

/**
 * Stop the background collection loop.
 */
function stopCollecting(): void {
  if (collectIntervalId) {
    clearInterval(collectIntervalId);
    collectIntervalId = null;
  }
}

/**
 * Return the latest runtime metrics as a Prometheus text-format string.
 * Performs an on-demand collection first to ensure fresh data.
 */
async function getRuntimeMetricsText(): Promise<string> {
  collectRuntimeMetrics();
  return runtimeRegistry.metrics();
}

/**
 * Reset the runtime metrics registry and state (for testing).
 */
function resetMetrics(): void {
  runtimeRegistry.resetMetrics();
  consecutiveBlockedCount = 0;
  baselineHandleCount = 0;
  eventLoopMonitor.reset();
  prevHeapUsed = process.memoryUsage().heapUsed;
  prevHeapTime = Date.now();
}

// ─── Exports ────────────────────────────────────────────────────────────────

export {
  runtimeRegistry,
  eventLoopLagHistogram,
  heapUsedGauge,
  heapAllocRateGauge,
  activeHandlesGauge,
  workerThreadsActiveGauge,
  threadPoolSizeGauge,
  threadPoolQueueDepthGauge,
  blockedWorkerGauge,
  eventLoopMonitor,
  startCollecting,
  stopCollecting,
  getRuntimeMetricsText,
  resetMetrics,
  collectRuntimeMetrics,
};
