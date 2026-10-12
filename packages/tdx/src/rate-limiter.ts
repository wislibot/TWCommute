export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * TDX counts requests per API key per minute (the free plan allows 5; response headers
 * `x-ratelimit-limit-minute`). A token bucket with a burst can exceed that: 5 at once, then
 * refills, gives 9 requests in the first minute. This limiter allows at most `limit` requests in
 * any `windowMs` (61 s by default, a second of margin for clock and network skew), whichever way
 * TDX aligns its minute. Every request from a process goes through one limiter.
 */
export class RateLimiter {
  /** Grant times of the most recent requests, oldest first (at most `limit`). */
  private grants: number[] = [];
  private pausedUntil = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 61_000,
    private readonly clock: Clock = systemClock,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
    if (windowMs <= 0) throw new Error("windowMs must be > 0");
  }

  /** Resolves when the caller may send one request. Callers are served in FIFO order. */
  acquire(): Promise<void> {
    const next = this.queue.then(() => this.take());
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Hold every request for `ms` (e.g. TDX answered 429 with Retry-After). */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + ms);
  }

  private async take(): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      if (now < this.pausedUntil) {
        await this.clock.sleep(this.pausedUntil - now);
        continue;
      }
      while (this.grants.length > 0 && (this.grants[0] as number) <= now - this.windowMs) this.grants.shift();
      if (this.grants.length < this.limit) {
        this.grants.push(now);
        return;
      }
      await this.clock.sleep((this.grants[0] as number) + this.windowMs - now);
    }
  }
}
