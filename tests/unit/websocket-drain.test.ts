import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RingBuffer, LifecycleEntry } from '../../src/websocket/ring-buffer';
import {
  DrainController,
  ConnectionState,
  SocketHandle,
} from '../../src/websocket/drain-controller';
import { TelemetryChannel } from '../../src/websocket/telemetry-channel';
import { ConnectionManager } from '../../src/websocket/connection-manager';
import {
  QUIESCENCE_TIMEOUT_S,
  DRAIN_GRACE_WINDOW_S,
  DRAIN_ACK_TIMEOUT_MS,
  MAX_PENDING_FRAMES,
  GOAWAY_OPCODE,
  BACKPRESSURE_429_OPCODE,
} from '../../src/config/websocket';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockHandle(id: string): SocketHandle & {
  sent: Buffer[];
  closed: boolean;
  destroyed: boolean;
} {
  return {
    id,
    sent: [],
    closed: false,
    destroyed: false,
    send(data: Buffer) {
      this.sent.push(data);
    },
    close() {
      this.closed = true;
    },
    destroy() {
      this.destroyed = true;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RingBuffer
// ═══════════════════════════════════════════════════════════════════════════

describe('RingBuffer', () => {
  it('stores entries up to capacity', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.size).toBe(3);
    expect([...buf]).toEqual([1, 2, 3]);
  });

  it('evicts oldest entry when full', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    const evicted = buf.push(4);
    expect(evicted).toBe(1);
    expect(buf.size).toBe(3);
    expect([...buf]).toEqual([2, 3, 4]);
  });

  it('returns undefined when not full', () => {
    const buf = new RingBuffer<number>(5);
    expect(buf.push(1)).toBeUndefined();
    expect(buf.push(2)).toBeUndefined();
  });

  it('handles O(1) eviction under load', () => {
    const capacity = 1000;
    const buf = new RingBuffer<number>(capacity);
    for (let i = 0; i < capacity * 3; i++) {
      buf.push(i);
    }
    expect(buf.size).toBe(capacity);
    // Oldest should be (capacity * 3 - capacity) = 2000
    expect(buf.peek()).toBe(2000);
    expect(buf.at(0)).toBe(2000);
    expect(buf.at(capacity - 1)).toBe(2999);
  });

  it('shift removes oldest entry', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(10);
    buf.push(20);
    buf.push(30);
    expect(buf.shift()).toBe(10);
    expect(buf.size).toBe(2);
    expect(buf.peek()).toBe(20);
  });

  it('shift on empty returns undefined', () => {
    const buf = new RingBuffer<number>(5);
    expect(buf.shift()).toBeUndefined();
  });

  it('clear resets the buffer', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.peek()).toBeUndefined();
  });

  it('at() with out-of-range index returns undefined', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    expect(buf.at(-1)).toBeUndefined();
    expect(buf.at(1)).toBeUndefined();
  });

  it('lifecycle entry ring buffer with 100k capacity', () => {
    const buf = new RingBuffer<LifecycleEntry>(100_000);
    for (let i = 0; i < 100_000; i++) {
      buf.push({
        socketId: `sock-${i}`,
        connectedAt: i,
        lastActivityAt: i,
        closedAt: 0,
      });
    }
    expect(buf.size).toBe(100_000);
    const evicted = buf.push({
      socketId: 'sock-overflow',
      connectedAt: 100_000,
      lastActivityAt: 100_000,
      closedAt: 0,
    });
    expect(evicted?.socketId).toBe('sock-0');
    expect(buf.size).toBe(100_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DrainController FSM
// ═══════════════════════════════════════════════════════════════════════════

describe('DrainController', () => {
  let ctrl: DrainController;

  beforeEach(() => {
    vi.useFakeTimers();
    ctrl = new DrainController();
  });

  afterEach(() => {
    ctrl.reset();
    vi.useRealTimers();
  });

  it('registers a connection as Active', () => {
    ctrl.register('s1');
    expect(ctrl.getState('s1')).toBe(ConnectionState.Active);
    expect(ctrl.getActiveCount()).toBe(1);
  });

  it('returns undefined state for unregistered socket', () => {
    expect(ctrl.getState('unknown')).toBeUndefined();
  });

  it('transitions Active → Draining on initiateDrain', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    const result = ctrl.initiateDrain('s1', handle, 'quiescence');
    expect(result).toBe(true);
    expect(ctrl.getState('s1')).toBe(ConnectionState.Draining);
    expect(ctrl.getDrainingCount()).toBe(1);
    // GOAWAY frame should be sent
    expect(handle.sent.length).toBe(1);
    expect(handle.sent[0]![0]).toBe(GOAWAY_OPCODE);
  });

  it('sends 429 frame on backpressure drain', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    ctrl.initiateDrain('s1', handle, 'backpressure');
    expect(handle.sent[0]![0]).toBe(BACKPRESSURE_429_OPCODE);
  });

  it('prevents double-drain (CAS)', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    ctrl.initiateDrain('s1', handle, 'quiescence');
    const second = ctrl.initiateDrain('s1', handle, 'quiescence');
    expect(second).toBe(false);
  });

  it('does not drain non-existent socket', () => {
    const handle = mockHandle('s1');
    expect(ctrl.initiateDrain('nope', handle, 'quiescence')).toBe(false);
  });

  it('transitions Draining → Closed after grace window + ACK timeout', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    ctrl.initiateDrain('s1', handle, 'quiescence');

    // Fast-forward past grace window
    vi.advanceTimersByTime(DRAIN_GRACE_WINDOW_S * 1000);
    expect(ctrl.getState('s1')).toBe(ConnectionState.Draining);

    // Fast-forward past ACK timeout
    vi.advanceTimersByTime(DRAIN_ACK_TIMEOUT_MS);
    expect(ctrl.getState('s1')).toBe(ConnectionState.Closed);
    // RST close because no ACK received
    expect(handle.destroyed).toBe(true);
  });

  it('closes cleanly when drain is acknowledged', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    ctrl.initiateDrain('s1', handle, 'quiescence');

    ctrl.acknowledgeDrain('s1', handle);
    expect(ctrl.getState('s1')).toBe(ConnectionState.Closed);
    expect(handle.closed).toBe(true);
    expect(handle.destroyed).toBe(false);
  });

  it('checkBackpressure triggers drain when frames exceed threshold', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    ctrl.setPendingFrames('s1', MAX_PENDING_FRAMES + 1);
    const triggered = ctrl.checkBackpressure('s1', handle);
    expect(triggered).toBe(true);
    expect(ctrl.getState('s1')).toBe(ConnectionState.Draining);
  });

  it('checkBackpressure does nothing below threshold', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    ctrl.setPendingFrames('s1', MAX_PENDING_FRAMES - 1);
    const triggered = ctrl.checkBackpressure('s1', handle);
    expect(triggered).toBe(false);
    expect(ctrl.getState('s1')).toBe(ConnectionState.Active);
  });

  it('forceClose RST-closes regardless of state', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    ctrl.forceClose('s1', handle);
    expect(ctrl.getState('s1')).toBe(ConnectionState.Closed);
    expect(handle.destroyed).toBe(true);
  });

  it('purge removes the entry', () => {
    ctrl.register('s1');
    ctrl.purge('s1');
    expect(ctrl.getState('s1')).toBeUndefined();
  });

  it('emits drain_started event', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    const events: string[] = [];
    ctrl.on('drain_started', (id: string, reason: string) => {
      events.push(`${id}:${reason}`);
    });
    ctrl.initiateDrain('s1', handle, 'quiescence');
    expect(events).toEqual(['s1:quiescence']);
  });

  it('emits connection_closed event with duration', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    const closedEvents: Array<{ socketId: string; rst: boolean; durationMs: number }> = [];
    ctrl.on('connection_closed', (socketId: string, info: { rst: boolean; durationMs: number }) => {
      closedEvents.push({ socketId, ...info });
    });

    ctrl.initiateDrain('s1', handle, 'quiescence');
    vi.advanceTimersByTime(5000);
    ctrl.acknowledgeDrain('s1', handle);

    expect(closedEvents).toHaveLength(1);
    expect(closedEvents[0]!.socketId).toBe('s1');
    expect(closedEvents[0]!.rst).toBe(false);
    expect(closedEvents[0]!.durationMs).toBeGreaterThanOrEqual(5000);
  });

  it('thundering-herd guard defers drain when ratio exceeded', () => {
    // Register many connections — with MAX_DRAINING_RATIO = 0.001,
    // after draining 1 out of 1000 we hit the limit
    for (let i = 0; i < 1000; i++) {
      ctrl.register(`s${i}`);
    }
    const h0 = mockHandle('s0');
    expect(ctrl.initiateDrain('s0', h0, 'quiescence')).toBe(true);

    // Now draining=1, active=999, total=1000; ratio=0.001 → at limit
    const h1 = mockHandle('s1');
    const deferred: string[] = [];
    ctrl.on('drain_deferred', (id: string) => deferred.push(id));
    const result = ctrl.initiateDrain('s1', h1, 'quiescence');
    expect(result).toBe(false);
    expect(deferred).toEqual(['s1']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TelemetryChannel
// ═══════════════════════════════════════════════════════════════════════════

describe('TelemetryChannel', () => {
  let ctrl: DrainController;

  beforeEach(() => {
    vi.useFakeTimers();
    ctrl = new DrainController();
  });

  afterEach(() => {
    ctrl.reset();
    vi.useRealTimers();
  });

  it('accepts frames when Active', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    const channel = new TelemetryChannel('s1', handle, ctrl);
    const received: Buffer[] = [];
    channel.onFrame((f) => received.push(f.payload));

    expect(channel.acceptFrame(Buffer.from('hello'))).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]!.toString()).toBe('hello');
  });

  it('rejects frames when Draining', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    const channel = new TelemetryChannel('s1', handle, ctrl);
    ctrl.initiateDrain('s1', handle, 'quiescence');

    expect(channel.acceptFrame(Buffer.from('x'))).toBe(false);
  });

  it('triggers backpressure when pending exceeds MAX_PENDING_FRAMES', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    const channel = new TelemetryChannel('s1', handle, ctrl);
    // No handler registered, so frames accumulate

    for (let i = 0; i <= MAX_PENDING_FRAMES; i++) {
      channel.acceptFrame(Buffer.from(`f${i}`));
    }
    // The frame that exceeds the limit triggers drain
    expect(ctrl.getState('s1')).toBe(ConnectionState.Draining);
  });

  it('flush delivers all pending frames', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    const channel = new TelemetryChannel('s1', handle, ctrl);
    const received: Buffer[] = [];

    // Accept without handler
    channel.acceptFrame(Buffer.from('a'));
    channel.acceptFrame(Buffer.from('b'));
    expect(channel.pendingCount).toBe(2);

    // Now register handler and flush
    channel.onFrame((f) => received.push(f.payload));
    const count = channel.flush();
    expect(count).toBe(2);
    expect(channel.pendingCount).toBe(0);
    expect(received).toHaveLength(2);
  });

  it('send forwards data to handle', () => {
    ctrl.register('s1');
    const handle = mockHandle('s1');
    const channel = new TelemetryChannel('s1', handle, ctrl);

    expect(channel.send(Buffer.from('out'))).toBe(true);
    expect(handle.sent).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ConnectionManager
// ═══════════════════════════════════════════════════════════════════════════

describe('ConnectionManager', () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ConnectionManager();
  });

  afterEach(() => {
    manager.reset();
    vi.useRealTimers();
  });

  it('addConnection registers and tracks the connection', () => {
    const handle = mockHandle('s1');
    const channel = manager.addConnection('s1', handle);
    expect(manager.connectionCount).toBe(1);
    expect(channel).toBeDefined();
    expect(manager.drainController.getState('s1')).toBe(ConnectionState.Active);
  });

  it('touchConnection updates lastActivityAt', () => {
    const handle = mockHandle('s1');
    manager.addConnection('s1', handle);
    const before = manager.getConnection('s1')!.lastActivityAt;

    vi.advanceTimersByTime(5000);
    manager.touchConnection('s1');
    expect(manager.getConnection('s1')!.lastActivityAt).toBeGreaterThan(before);
  });

  it('scanQuiescent drains connections exceeding quiescence timeout', () => {
    const handle = mockHandle('s1');
    manager.addConnection('s1', handle);

    vi.advanceTimersByTime(QUIESCENCE_TIMEOUT_S * 1000);
    manager.scanQuiescent();

    expect(manager.drainController.getState('s1')).toBe(ConnectionState.Draining);
  });

  it('scanQuiescent does not drain recently active connections', () => {
    const handle = mockHandle('s1');
    manager.addConnection('s1', handle);

    vi.advanceTimersByTime(60_000); // only 60s
    manager.touchConnection('s1');
    vi.advanceTimersByTime(60_000); // total 120s but activity at 60s

    manager.scanQuiescent();
    expect(manager.drainController.getState('s1')).toBe(ConnectionState.Active);
  });

  it('healthCheck reports unhealthy when connections are draining', () => {
    const handle = mockHandle('s1');
    manager.addConnection('s1', handle);

    expect(manager.healthCheck().healthy).toBe(true);

    manager.drainController.initiateDrain('s1', handle, 'quiescence');
    const health = manager.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.drainingConnections).toBe(1);
  });

  it('lifecycle buffer records connection events', () => {
    const handle = mockHandle('s1');
    manager.addConnection('s1', handle);
    expect(manager.lifecycleBuffer.size).toBe(1);

    // Force close to trigger recordClose
    manager.drainController.forceClose('s1', handle);
    // addConnection + close event = 2 entries
    expect(manager.lifecycleBuffer.size).toBe(2);
  });

  it('removeConnection purges all state', () => {
    const handle = mockHandle('s1');
    manager.addConnection('s1', handle);
    manager.removeConnection('s1');

    expect(manager.connectionCount).toBe(0);
    expect(manager.drainController.getState('s1')).toBeUndefined();
  });

  it('startScanning / stopScanning manages the interval', () => {
    manager.startScanning(100);
    const handle = mockHandle('s1');
    manager.addConnection('s1', handle);

    vi.advanceTimersByTime(QUIESCENCE_TIMEOUT_S * 1000 + 200);
    expect(manager.drainController.getState('s1')).toBe(ConnectionState.Draining);

    manager.stopScanning();
  });
});
