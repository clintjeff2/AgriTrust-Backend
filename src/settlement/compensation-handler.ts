import { SagaLogStore } from '../database/saga_log';
import { SagaContext, SagaStep, StepOutcome, withTimeout, sleep } from './saga-step';

export interface CompensationConfig {
  /** Max attempts per compensating action (best-effort). */
  retries: number;
  /** Backoff between compensation attempts, in milliseconds. */
  backoffMs: number;
  /** Per-compensation execution timeout, in milliseconds. */
  stepTimeoutMs: number;
}

export interface CompensationResult {
  stepId: string;
  success: boolean;
  attempts: number;
  error?: string;
}

/**
 * Executes compensating transactions for the already-completed steps of a
 * failed saga, in reverse order. Each compensation is best-effort and retried
 * up to `retries` times with a fixed backoff. A compensation that exhausts its
 * retries is logged as a CRITICAL alert — the saga is left in an inconsistent
 * state that requires operator attention.
 */
export class CompensationHandler {
  constructor(
    private readonly log: SagaLogStore,
    private readonly config: CompensationConfig,
  ) {}

  /**
   * @param completed Steps that ran successfully, in *forward* order. They are
   *                  compensated here in reverse.
   */
  async compensate(
    sagaId: string,
    completed: SagaStep[],
    ctx: SagaContext,
  ): Promise<CompensationResult[]> {
    const results: CompensationResult[] = [];

    for (let i = completed.length - 1; i >= 0; i--) {
      const step = completed[i];
      results.push(await this.compensateStep(sagaId, step, ctx));
    }

    return results;
  }

  private async compensateStep(
    sagaId: string,
    step: SagaStep,
    ctx: SagaContext,
  ): Promise<CompensationResult> {
    await this.log.recordStep(sagaId, step.id, 'compensating');

    let lastError = 'unknown';

    for (let attempt = 1; attempt <= this.config.retries; attempt++) {
      try {
        const outcome: StepOutcome = await withTimeout(
          step.compensate(ctx),
          this.config.stepTimeoutMs,
          `compensate:${step.id}`,
        );

        if (outcome.ok) {
          await this.log.recordStep(sagaId, step.id, 'compensated', {
            attempts: attempt,
          });
          return { stepId: step.id, success: true, attempts: attempt };
        }

        lastError = outcome.reason;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }

      if (attempt < this.config.retries) {
        await sleep(this.config.backoffMs);
      }
    }

    // All attempts exhausted — record failure and raise a critical alert.
    await this.log.recordStep(
      sagaId,
      step.id,
      'compensation_failed',
      { attempts: this.config.retries },
      lastError,
    );
    this.criticalAlert(sagaId, step.id, lastError);

    return {
      stepId: step.id,
      success: false,
      attempts: this.config.retries,
      error: lastError,
    };
  }

  private criticalAlert(sagaId: string, stepId: string, error: string): void {
    console.error(
      `[CRITICAL] Saga compensation failed and could not be rolled back. ` +
        `saga_id=${sagaId} step_id=${stepId} error=${error} ` +
        `Manual intervention required.`,
    );
  }
}
