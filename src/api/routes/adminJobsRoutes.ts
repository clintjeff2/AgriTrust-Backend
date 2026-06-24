import { Router, Request, Response } from 'express';
import { Scheduler } from '../../job-queue/scheduler';
import { JobQueuePersistence } from '../../job-queue/persistence';
import { WorkerPool } from '../../job-queue/worker-pool';
import { Priority } from '../../job-queue/types';

export function createAdminJobsRouter(
  scheduler: Scheduler,
  persistence: JobQueuePersistence,
  workerPool: WorkerPool,
): Router {
  const router = Router();

  /**
   * GET /admin/jobs/queue
   * Full snapshot of the job queue: pending by priority, active jobs,
   * and worker utilisation.
   */
  router.get('/jobs/queue', async (_req: Request, res: Response) => {
    try {
      const byPriority: Record<string, unknown> = {};
      for (const p of [1, 2, 3, 4, 5]) {
        byPriority[String(p)] = await persistence.peekAll(p as Priority, 100);
      }

      const active = workerPool.listActive();
      const workerUtilisation = workerPool.getActiveByType();
      const totalDepth = await persistence.totalDepth();
      const deficits = scheduler.getDeficits();

      res.status(200).json({
        byPriority,
        active,
        workerUtilisation,
        totalDepth,
        deficits,
        workerPoolSize: workerPool.capacity,
        activeCount: workerPool.activeCount,
        schedulerRunning: scheduler.isRunning(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Admin] GET /jobs/queue error:`, msg);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/jobs/rebalance
   * Force-reset the deficit counters — useful after a burst of
   * high-priority jobs saturates the pool.
   */
  router.post('/jobs/rebalance', (_req: Request, res: Response) => {
    try {
      scheduler.rebalance();
      res.status(200).json({
        message: 'Deficit counters reset',
        deficits: scheduler.getDeficits(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Admin] POST /jobs/rebalance error:`, msg);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/jobs/cancel/:id
   * Cancel a pending job by id.
   */
  router.post('/jobs/cancel/:id', async (req: Request, res: Response) => {
    try {
      const jobId = req.params.id as string;
      const removed = await persistence.remove(jobId);
      if (removed) {
        res.status(200).json({ message: `Job ${jobId} cancelled`, jobId });
      } else {
        res.status(404).json({ error: `Job ${jobId} not found` });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Admin] POST /jobs/cancel error:`, msg);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /admin/jobs/workers/resize — adjust worker pool size dynamically. */
  router.post('/jobs/workers/resize', (req: Request, res: Response) => {
    try {
      const newSize = typeof req.body?.size === 'number' ? req.body.size : null;
      if (newSize == null || newSize < 1) {
        res.status(400).json({ error: 'Provide a valid "size" >= 1' });
        return;
      }
      workerPool.resize(newSize);
      res.status(200).json({
        message: `Worker pool resized to ${newSize}`,
        poolSize: workerPool.capacity,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Admin] POST /jobs/workers/resize error:`, msg);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}