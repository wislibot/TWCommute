import type { FeedHealth } from "@twc/contracts";

interface FeedState {
  intervalMs: number;
  lastSuccessAt: number | null;
  lastError: string | null;
}

/** Tracks freshness of every polled feed so /health and the API can label data honestly. */
export class HealthRegistry {
  private feeds = new Map<string, FeedState>();

  constructor(private readonly now: () => number = Date.now) {}

  register(feed: string, intervalMs: number): void {
    if (!this.feeds.has(feed)) this.feeds.set(feed, { intervalMs, lastSuccessAt: null, lastError: null });
  }

  success(feed: string): void {
    const s = this.feeds.get(feed);
    if (s) {
      s.lastSuccessAt = this.now();
      s.lastError = null;
    }
  }

  failure(feed: string, error: unknown): void {
    const s = this.feeds.get(feed);
    if (s) s.lastError = error instanceof Error ? error.message : String(error);
  }

  /** A feed is healthy if it succeeded within three polling intervals. */
  snapshot(): FeedHealth[] {
    const now = this.now();
    return [...this.feeds.entries()].map(([feed, s]) => {
      const ageSeconds = s.lastSuccessAt === null ? null : Math.round((now - s.lastSuccessAt) / 1000);
      return {
        feed,
        lastSuccessAt: s.lastSuccessAt === null ? null : new Date(s.lastSuccessAt).toISOString(),
        lastError: s.lastError,
        ageSeconds,
        healthy: ageSeconds !== null && ageSeconds * 1000 <= s.intervalMs * 3,
      };
    });
  }
}
