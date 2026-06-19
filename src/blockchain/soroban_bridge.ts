import { xdr } from '@stellar/stellar-sdk';

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

        const data = (await response.json()) as Record<string, unknown>;
        return {
          sequence: Number(data.sequence),
          closed_at: String(data.closed_at),
          transaction_set_hash: String(data.transaction_set_hash),
          successful_transaction_count: Number(data.successful_transaction_count ?? 0),
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
      const data = (await response.json()) as { _embedded?: { records?: HorizonEffect[] } };
      return (data._embedded?.records ?? []) as HorizonEffect[];
    } catch {
      return [];
    }
  }
}

export interface SorobanRpcConfig {
  rpcUrl: string;
  timeoutMs: number;
}

export interface RawSimulationResult {
  transactionData: string;
  minResourceFee: number;
  footprint: string;
  instructions: number;
  readBytes: number;
  writeBytes: number;
  ledgerEntriesRead: number;
  ledgerEntriesWritten: number;
}

export class SorobanRpcClient {
  private config: SorobanRpcConfig;

  constructor(config: SorobanRpcConfig) {
    this.config = config;
  }

  async simulateTransaction(transactionXdr: string): Promise<RawSimulationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'simulateTransaction',
          params: { transaction: transactionXdr },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`RPC returned ${response.status}`);
      }

      const json = (await response.json()) as {
        error?: { message: string };
        result?: { transactionData: string; minResourceFee?: number; footprint?: string };
      };
      if (json.error) {
        throw new Error(`RPC error: ${json.error.message}`);
      }

      const result = json.result!;
      const txData = result.transactionData;

      const parsed = decodeSorobanTransactionData(txData);

      return {
        transactionData: txData,
        minResourceFee: result.minResourceFee ?? 0,
        footprint: result.footprint ?? '',
        instructions: parsed.instructions,
        readBytes: parsed.readBytes,
        writeBytes: parsed.writeBytes,
        ledgerEntriesRead: parsed.ledgerEntriesRead,
        ledgerEntriesWritten: parsed.ledgerEntriesWritten,
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }
}

function decodeSorobanTransactionData(transactionDataXdr: string): {
  instructions: number;
  readBytes: number;
  writeBytes: number;
  ledgerEntriesRead: number;
  ledgerEntriesWritten: number;
} {
  try {
    const txData = xdr.SorobanTransactionData.fromXDR(transactionDataXdr, 'base64');
    const resources = txData.resources();
    const footprint = resources.footprint();

    return {
      instructions: resources.instructions(),
      readBytes: resources.diskReadBytes(),
      writeBytes: resources.writeBytes(),
      ledgerEntriesRead: footprint.readOnly().length,
      ledgerEntriesWritten: footprint.readWrite().length,
    };
  } catch {
    return {
      instructions: 0,
      readBytes: 0,
      writeBytes: 0,
      ledgerEntriesRead: 0,
      ledgerEntriesWritten: 0,
    };
  }
}
