import { Pool, PoolConfig } from 'pg';
import { backpressure, BackpressureLevel } from '../sensors/backpressure';

class MonitoredPool {
  pool: Pool;
  private maxConnections: number;
  private acquired: number = 0;
  private totalCreated: number = 0;
  private lastUtilization: number = 0;

  constructor(config: PoolConfig & { max?: number }) {
    this.maxConnections = config.max ?? 10;
    this.pool = new Pool(config);

    this.pool.on('connect', () => {
      this.totalCreated++;
      this.acquired++;
      this.updateBackpressure();
    });

    this.pool.on('acquire', () => {
      this.acquired++;
      this.updateBackpressure();
    });

    this.pool.on('remove', () => {
      this.maxConnections = Math.max(1, this.maxConnections - 1);
      this.acquired = Math.max(0, this.acquired - 1);
      this.updateBackpressure();
    });

    const origRelease = (this.pool as any).release?.bind(this.pool);
    this.pool.on('release', () => {
      this.acquired = Math.max(0, this.acquired - 1);
      this.updateBackpressure();
    });
  }

  private updateBackpressure(): void {
    const available = this.maxConnections - this.acquired;
    this.lastUtilization = this.maxConnections > 0
      ? (this.acquired / this.maxConnections) * 100
      : 0;

    const availableRatio = this.maxConnections > 0
      ? available / this.maxConnections
      : 0;

    if (availableRatio < 0.1) {
      backpressure.setBackpressure('connection_pool', BackpressureLevel.CRITICAL);
    } else if (availableRatio >= 0.3) {
      backpressure.setBackpressure('connection_pool', BackpressureLevel.NORMAL);
    }
  }

  getUtilization(): number {
    return this.lastUtilization;
  }

  getAcquired(): number {
    return this.acquired;
  }

  getMaxConnections(): number {
    return this.maxConnections;
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export { MonitoredPool };

export function createMonitoredPool(opts: { max?: number } & Partial<PoolConfig> = {}): MonitoredPool {
  const cfg: PoolConfig & { max?: number } = {
    connectionString: process.env.DATABASE_URL,
    ...opts,
  } as any;
  return new MonitoredPool(cfg);
}
