export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Token-bucket limiter. TDX enforces a per-API-key request rate that depends on the
 * subscription tier, so every request from this process goes through one limiter.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number = Math.max(1, Math.floor(ratePerSecond)),
    private readonly clock: Clock = systemClock,
  ) {
    if (ratePerSecond <= 0) throw new Error("ratePerSecond must be > 0");
    this.tokens = burst;
    this.lastRefill = clock.now();
  }

  /** Resolves when the caller may send one request. Callers are served in FIFO order. */
  acquire(): Promise<void> {
    const next = this.queue.then(() => this.take());
    this.queue = next.catch(() => undefined);
    return next;
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSecond);
    this.lastRefill = now;
  }

  private async take(): Promise<void> {
    this.refill();
    while (this.tokens < 1) {
      const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSecond) * 1000);
      await this.clock.sleep(waitMs);
      this.refill();
    }
    this.tokens -= 1;
  }
}
