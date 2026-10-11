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

/**
 * Runs jobs on fixed intervals. A job never overlaps itself; a slow run delays the next one
 * instead of piling up requests against TDX.
 */
export class Scheduler {
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;

  constructor(
    private readonly health: HealthRegistry,
    private readonly log: Logger,
  ) {}

  add(job: Job, initialDelayMs = 0): void {
    this.health.register(job.name, job.intervalMs);
    const tick = async () => {
      if (this.stopped) return;
      const started = Date.now();
      try {
        await job.run();
        this.health.success(job.name);
      } catch (err) {
        this.health.failure(job.name, err);
        this.log.warn({ job: job.name, err: (err as Error).message }, "job failed");
      }
      if (this.stopped) return;
      const elapsed = Date.now() - started;
      this.timers.push(setTimeout(tick, Math.max(0, job.intervalMs - elapsed)));
    };
    this.timers.push(setTimeout(tick, initialDelayMs));
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
