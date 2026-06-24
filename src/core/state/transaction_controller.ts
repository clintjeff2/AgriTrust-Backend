import { randomUUID } from 'crypto';
import { PendingStore, PendingTransactionRow } from './pending_store';

/** Timeout for the Soroban confirmation phase (seconds). */
const DEFAULT_TIMEOUT_S = 30;

export interface PrepareParams {
  cargoId: string;
  operationType: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  /** Override the default 30-second timeout (in seconds). */
  timeoutS?: number;
}

/**
 * Two-phase commit coordinator.
 *
 * Phase 1 — `prepare`: writes a tentative row with status='pending' and a
 *   unique tx_uuid.  The caller should apply the state change in its
 *   application cache with a tentative flag.
 *
 * Phase 2 — `commit`: on receiving a confirmed Soroban ledger hash, finalises
 *   the pending row (status='committed', soroban_hash set).
 *
 * Rollback — `rollback`: reverts the tentative row (status='rolled_back').
 *   The caller is responsible for restoring `before_state` in the database.
 *
 * Invariants:
 *  - No two pending transactions for the same cargo_id may overlap; the
 *    PendingStore enforces this with a SELECT … FOR UPDATE guard.
 *  - Tentative state survives process restarts because it is persisted in the
 *    `pending_transactions` table.
 */
export class TransactionCoordinator {
  constructor(private readonly store: PendingStore) {}

  /**
   * Phase 1: inserts a pending row and returns its UUID.
   *
   * The coordinator UUID can be used to commit or rollback later.
   */
  async prepare(params: PrepareParams): Promise<string> {
    const txUuid = randomUUID();
    const timeoutMs = (params.timeoutS ?? DEFAULT_TIMEOUT_S) * 1000;
    const timeoutAt = new Date(Date.now() + timeoutMs);

    await this.store.insert({
      txUuid,
      cargoId: params.cargoId,
      operationType: params.operationType,
      beforeState: params.beforeState,
      afterState: params.afterState,
      timeoutAt,
    });

    return txUuid;
  }

  /**
   * Phase 2: finalises the pending row after on-chain confirmation.
   *
   * @param txUuid  The coordinator UUID returned by `prepare`.
   * @param sorobanHash  The confirmed ledger hash from the Soroban network.
   */
  async commit(txUuid: string, sorobanHash: string): Promise<void> {
    await this.store.markCommitted(txUuid, sorobanHash);
  }

  /**
   * Rollback: reverts the tentative state.
   *
   * Called when the Soroban submission fails, times out, or the on-chain
   * result cannot be verified.
   */
  async rollback(txUuid: string): Promise<void> {
    await this.store.markRolledBack(txUuid);
  }

  /** Returns the current state of a pending transaction. */
  async getTransaction(txUuid: string): Promise<PendingTransactionRow | null> {
    return this.store.getByUuid(txUuid);
  }
}
