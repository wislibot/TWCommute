import type { HealthRegistry } from "./health";

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

/** First retry after a failed run; doubles per consecutive failure, capped at the job interval. */
export const RETRY_BASE_MS = 60_000;

/**
 * Delay before a job's next run. After a success: the rest of the interval. After failures: a
 * backoff of 60 s, 120 s, 240 s… so a 12-hour route-list job is not left empty for 12 hours by
 * one failed request, but never retried more often than its own interval.
 */
export function nextDelayMs(intervalMs: number, elapsedMs: number, consecutiveFailures: number): number {
  const wait =
    consecutiveFailures > 0
      ? Math.min(intervalMs, RETRY_BASE_MS * 2 ** Math.min(consecutiveFailures - 1, 20))
      : intervalMs;
  return Math.max(0, wait - elapsedMs);
}

/**
 * Runs jobs on fixed intervals. A job never overlaps itself; a slow run delays the next one
 * instead of piling up requests against TDX. Failed runs are retried sooner (`nextDelayMs`).
 */
export class Scheduler {
  /** The pending timer of each job. */
  private timers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(
    private readonly health: HealthRegistry,
    private readonly log: Logger,
  ) {}

  add(job: Job, initialDelayMs = 0): void {
    this.health.register(job.name, job.intervalMs);
    let failures = 0;
    const tick = async () => {
      if (this.stopped) return;
      const started = Date.now();
      try {
        await job.run();
        failures = 0;
        this.health.success(job.name);
      } catch (err) {
        failures++;
        this.health.failure(job.name, err);
        this.log.warn({ job: job.name, failures, err: (err as Error).message }, "job failed");
      }
      if (this.stopped) return;
      this.timers.set(job.name, setTimeout(tick, nextDelayMs(job.intervalMs, Date.now() - started, failures)));
    };
    this.timers.set(job.name, setTimeout(tick, initialDelayMs));
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
