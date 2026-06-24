/**
 * AgriTrust Backend – Per-Connection Telemetry Frame Routing
 *
 * Each WebSocket connection is wrapped in a TelemetryChannel that:
 *   1. Tracks pending outbound frames.
 *   2. Forwards inbound telemetry frames to a subscriber callback.
 *   3. Respects drain state — stops accepting new frames once draining.
 *   4. Provides flush() to drain the pending queue within the grace window.
 */

import { EventEmitter } from 'events';
import { MAX_PENDING_FRAMES } from '../config/websocket';
import { ConnectionState, DrainController, SocketHandle } from './drain-controller';

export interface TelemetryFrame {
  socketId: string;
  payload: Buffer;
  receivedAt: number;
}

export type FrameHandler = (frame: TelemetryFrame) => void;

export class TelemetryChannel extends EventEmitter {
  readonly socketId: string;
  private readonly handle: SocketHandle;
  private readonly drainCtrl: DrainController;
  private readonly pendingQueue: TelemetryFrame[] = [];
  private handler: FrameHandler | null = null;

  constructor(socketId: string, handle: SocketHandle, drainCtrl: DrainController) {
    super();
    this.socketId = socketId;
    this.handle = handle;
    this.drainCtrl = drainCtrl;
  }

  /** Register a downstream consumer for inbound frames. */
  onFrame(handler: FrameHandler): void {
    this.handler = handler;
  }

  /**
   * Accept an inbound frame. Returns `false` if the channel refuses
   * the frame (connection draining/closed or backpressure exceeded).
   */
  acceptFrame(payload: Buffer): boolean {
    const state = this.drainCtrl.getState(this.socketId);
    if (state !== ConnectionState.Active) return false;

    const frame: TelemetryFrame = {
      socketId: this.socketId,
      payload,
      receivedAt: Date.now(),
    };

    this.pendingQueue.push(frame);
    this.drainCtrl.recordFrame(this.socketId);

    // Check backpressure
    if (this.pendingQueue.length > MAX_PENDING_FRAMES) {
      this.drainCtrl.checkBackpressure(this.socketId, this.handle);
      return false;
    }

    // Deliver immediately if handler registered
    if (this.handler) {
      this.deliverPending();
    }

    return true;
  }

  /** Send an outbound frame to the client. */
  send(data: Buffer): boolean {
    const state = this.drainCtrl.getState(this.socketId);
    if (state === ConnectionState.Closed) return false;

    try {
      this.handle.send(data);
      return true;
    } catch {
      return false;
    }
  }

  /** Flush all pending frames to the handler. */
  flush(): number {
    return this.deliverPending();
  }

  /** Number of frames awaiting delivery. */
  get pendingCount(): number {
    return this.pendingQueue.length;
  }

  private deliverPending(): number {
    let delivered = 0;
    while (this.pendingQueue.length > 0) {
      const frame = this.pendingQueue.shift()!;
      this.drainCtrl.ackFrame(this.socketId);
      if (this.handler) {
        this.handler(frame);
      }
      delivered++;
    }
    return delivered;
  }
}
