export interface HorizonLedger {
  sequence: number;
  closed_at: string;
  transaction_set_hash: string;
  successful_transaction_count: number;
}

export interface HorizonEffect {
  type: string;
  account?: string;
  amount?: string;
  asset_type?: string;
}

export interface HorizonBlockData {
  ledger: HorizonLedger;
  effects: HorizonEffect[];
}

export interface SorobanBridgeConfig {
  horizonUrl: string;
  timeoutMs: number;
  maxRetries: number;
}

export class SorobanBridge {
  private config: SorobanBridgeConfig;

  constructor(config: SorobanBridgeConfig) {
    this.config = config;
  }

  async getLedger(sequence: number): Promise<HorizonLedger | null> {
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await fetch(
          `${this.config.horizonUrl}/ledgers/${sequence}`,
          { signal: controller.signal },
        );
        clearTimeout(timeout);

        if (response.status === 404) return null;
        if (!response.ok) {
          throw new Error(`Horizon returned ${response.status}`);
        }

        const data = await response.json();
        return {
          sequence: data.sequence,
          closed_at: data.closed_at,
          transaction_set_hash: data.transaction_set_hash,
          successful_transaction_count: data.successful_transaction_count ?? 0,
        };
      } catch (err) {
        if (attempt === this.config.maxRetries) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
    return null;
  }

  async getLedgerEffects(sequence: number): Promise<HorizonEffect[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(
        `${this.config.horizonUrl}/ledgers/${sequence}/effects`,
        { signal: controller.signal },
      );
      clearTimeout(timeout);

      if (!response.ok) return [];
      const data = await response.json();
      return (data._embedded?.records ?? []) as HorizonEffect[];
    } catch {
      return [];
    }
  }
}
