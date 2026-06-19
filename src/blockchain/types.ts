export interface ResourceFootprint {
  instructions: number;
  readBytes: number;
  writeBytes: number;
  ledgerEntriesRead: number;
  ledgerEntriesWritten: number;
}

export interface PreflightResult {
  resourceFootprint: ResourceFootprint;
  minResourceFee: number;
  transactionEnvelopeXdr: string;
}

export class PreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightError';
  }
}

export interface PreflightOptions {
  contractId: string;
  functionName: string;
  functionArgs: string[];
  sourceSecret: string;
  rpcUrl: string;
  networkPassphrase: string;
}

export const SOROBAN_NETWORK_MAX: ResourceFootprint = {
  instructions: 10_000_000,
  readBytes: 200_000,
  writeBytes: 100_000,
  ledgerEntriesRead: 50,
  ledgerEntriesWritten: 50,
};
