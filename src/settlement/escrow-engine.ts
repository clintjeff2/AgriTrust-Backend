import { SagaDefinition } from './saga-coordinator';
import { SagaContext, StepOutcome, ok, err } from './saga-step';

/**
 * Minimal escrow lifecycle used to wire the settlement saga together.
 *
 * The original escrow state machine lives in issue #24; this engine exposes the
 * forward operations (hold → verify → release) and their inverses
 * (releaseHold / reverseRelease) so the saga coordinator can drive a fully
 * compensatable settlement. Replace the in-memory store with the real escrow
 * ledger once #24 lands.
 */

export type EscrowStatus =
  | 'none'
  | 'held'
  | 'verified'
  | 'released'
  | 'reversed';

export interface EscrowRecord {
  escrowId: string;
  amount: number;
  status: EscrowStatus;
}

export class EscrowEngine {
  private readonly store = new Map<string, EscrowRecord>();

  getState(escrowId: string): EscrowRecord | undefined {
    return this.store.get(escrowId);
  }

  /** Forward: place a hold on the escrowed funds. */
  async hold(escrowId: string, amount: number): Promise<StepOutcome<EscrowRecord>> {
    if (amount <= 0) {
      return err(`Invalid escrow amount: ${amount}`);
    }
    const record: EscrowRecord = { escrowId, amount, status: 'held' };
    this.store.set(escrowId, record);
    return ok(record);
  }

  /** Compensation for `hold`: drop the hold. Idempotent. */
  async releaseHold(escrowId: string): Promise<StepOutcome<EscrowRecord>> {
    const record = this.store.get(escrowId);
    if (!record) {
      return ok({ escrowId, amount: 0, status: 'none' });
    }
    record.status = 'none';
    return ok(record);
  }

  /** Forward: verify the held funds satisfy settlement preconditions. */
  async verify(escrowId: string): Promise<StepOutcome<EscrowRecord>> {
    const record = this.store.get(escrowId);
    if (!record || record.status !== 'held') {
      return err(`Escrow ${escrowId} is not in a verifiable (held) state`);
    }
    record.status = 'verified';
    return ok(record);
  }

  /** Compensation for `verify`: revert verification. Idempotent. */
  async unverify(escrowId: string): Promise<StepOutcome<EscrowRecord>> {
    const record = this.store.get(escrowId);
    if (record && record.status === 'verified') {
      record.status = 'held';
    }
    return ok(record ?? { escrowId, amount: 0, status: 'none' });
  }

  /** Forward: release funds to the beneficiary. */
  async release(escrowId: string): Promise<StepOutcome<EscrowRecord>> {
    const record = this.store.get(escrowId);
    if (!record || record.status !== 'verified') {
      return err(`Escrow ${escrowId} must be verified before release`);
    }
    record.status = 'released';
    return ok(record);
  }

  /** Compensation for `release`: reverse the release. Idempotent. */
  async reverseRelease(escrowId: string): Promise<StepOutcome<EscrowRecord>> {
    const record = this.store.get(escrowId);
    if (record && record.status === 'released') {
      record.status = 'reversed';
    }
    return ok(record ?? { escrowId, amount: 0, status: 'none' });
  }
}

export interface SettlementParams {
  escrowId: string;
  amount: number;
}

/**
 * Builds the canonical hold → verify → release settlement saga, each step
 * paired with its compensating action.
 */
export function buildSettlementSaga(
  engine: EscrowEngine,
  params: SettlementParams,
): SagaDefinition {
  const { escrowId, amount } = params;
  return {
    name: 'escrow-settlement',
    steps: [
      {
        id: 'hold',
        action: (_ctx: SagaContext) => engine.hold(escrowId, amount),
        compensate: (_ctx: SagaContext) => engine.releaseHold(escrowId),
      },
      {
        id: 'verify',
        action: (_ctx: SagaContext) => engine.verify(escrowId),
        compensate: (_ctx: SagaContext) => engine.unverify(escrowId),
      },
      {
        id: 'release',
        action: (_ctx: SagaContext) => engine.release(escrowId),
        compensate: (_ctx: SagaContext) => engine.reverseRelease(escrowId),
      },
    ],
  };
}
