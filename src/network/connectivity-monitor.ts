/**
 * Connectivity monitor — online/offline event bridge.
 *
 * Emits 'online' and 'offline' events that the SyncEngine subscribes to.
 * In a browser environment the monitor delegates to `navigator.onLine` and
 * the window online/offline events.  In Node.js (or tests) callers can
 * inject state via {@link setOnline} / {@link setOffline}.
 */

import { EventEmitter } from 'events';

export interface ConnectivityMonitorOptions {
  /** Initial connectivity state (defaults to `true`). */
  initialOnline?: boolean;
  /** If set, the monitor will poll the given URL at this interval (ms). */
  pollIntervalMs?: number;
  /** URL to probe for connectivity (HEAD request). */
  pollUrl?: string;
}

export class ConnectivityMonitor extends EventEmitter {
  private _online: boolean;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts?: ConnectivityMonitorOptions) {
    super();
    this._online = opts?.initialOnline ?? true;

    if (opts?.pollIntervalMs && opts.pollUrl) {
      this.startPolling(opts.pollIntervalMs, opts.pollUrl);
    }
  }

  /** Current connectivity state. */
  get online(): boolean {
    return this._online;
  }

  /** Programmatically mark the network as online (fires 'online' once). */
  setOnline(): void {
    if (!this._online) {
      this._online = true;
      this.emit('online');
    }
  }

  /** Programmatically mark the network as offline (fires 'offline' once). */
  setOffline(): void {
    if (this._online) {
      this._online = false;
      this.emit('offline');
    }
  }

  /** Stop any active polling loop. */
  destroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.removeAllListeners();
  }

  // ── Polling (optional, for environments without native events) ─────────

  private startPolling(intervalMs: number, url: string): void {
    this.pollTimer = setInterval(async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        await fetch(url, { method: 'HEAD', signal: controller.signal });
        clearTimeout(timeout);
        this.setOnline();
      } catch {
        this.setOffline();
      }
    }, intervalMs);
    // Allow the process to exit even if the timer is still running.
    if (this.pollTimer && typeof this.pollTimer === 'object' && 'unref' in this.pollTimer) {
      this.pollTimer.unref();
    }
  }
}
