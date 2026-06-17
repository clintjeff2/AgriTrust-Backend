import { Pool } from 'pg';

export interface LedgerEvent {
  sequence: number;
  eventIndex: number;
  transactionHash: string;
  eventType: string;
  payload: string;
  closedAt: Date;
}

export class EventProcessor {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insertEvents(events: LedgerEvent[]): Promise<number> {
    if (events.length === 0) return 0;

    const values = events.map((_, i) => {
      const offset = i * 6;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
    });

    const params: unknown[] = [];
    for (const e of events) {
      params.push(e.sequence, e.eventIndex, e.transactionHash, e.eventType, e.payload, e.closedAt);
    }

    await this.pool.query(
      `INSERT INTO ledger_events (sequence, event_index, transaction_hash, event_type, payload, closed_at)
       VALUES ${values.join(', ')}
       ON CONFLICT (sequence, event_index) DO NOTHING`,
      params,
    );

    return events.length;
  }

  async getMaxSequence(): Promise<number> {
    const result = await this.pool.query(
      'SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM ledger_events',
    );
    return result.rows[0]?.max_seq ?? 0;
  }

  async eventExists(sequence: number, eventIndex: number): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM ledger_events WHERE sequence = $1 AND event_index = $2',
      [sequence, eventIndex],
    );
    return result.rowCount !== null && result.rowCount > 0;
  }
}
