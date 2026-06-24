/**
 * AgriTrust Backend – WebSocket Timeout & Buffer Configuration
 *
 * Centralises every tunable for the WebSocket connection lifecycle,
 * drain protocol, and backpressure thresholds.
 */

// ─── Quiescence & Drain Timing ──────────────────────────────────────────────

/** Seconds of silence before a connection is considered quiescent. */
export const QUIESCENCE_TIMEOUT_S = 120;

/** Grace window (seconds) after entering Draining before forceful close. */
export const DRAIN_GRACE_WINDOW_S = 30;

/** Max milliseconds to wait for a drain-ACK before RST-closing the socket. */
export const DRAIN_ACK_TIMEOUT_MS = 500;

/** Background scan interval (milliseconds) for quiescent connections. */
export const SCAN_TICK_INTERVAL_MS = 10_000;

// ─── Backpressure ───────────────────────────────────────────────────────────

/** Maximum pending outbound frames per connection before triggering drain. */
export const MAX_PENDING_FRAMES = 4096;

// ─── Thundering-Herd Guard ──────────────────────────────────────────────────

/**
 * Upper bound on the fraction of active connections that may be in
 * Draining state simultaneously (0.001 = 0.1 %).
 */
export const MAX_DRAINING_RATIO = 0.001;

// ─── Ring Buffer ────────────────────────────────────────────────────────────

/** Capacity of the bounded lifecycle ring buffer. */
export const RING_BUFFER_CAPACITY = 100_000;

// ─── Control Frame Opcodes ──────────────────────────────────────────────────

/** Custom GOAWAY frame opcode sent to the client on drain initiation. */
export const GOAWAY_OPCODE = 0x08;

/** HTTP 429 status frame sent when backpressure is exceeded. */
export const BACKPRESSURE_429_OPCODE = 0x09;
