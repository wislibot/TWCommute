import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter";
import { FakeClock } from "./test-utils";

describe("RateLimiter", () => {
  it("never allows more than the limit in any window (TDX free plan: 5 per minute)", async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(5, 61_000, clock);
    const times: number[] = [];
    for (let i = 0; i < 12; i++) {
      await limiter.acquire();
      times.push(clock.now());
    }
    expect(times.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(times.slice(5, 10)).toEqual([61_000, 61_000, 61_000, 61_000, 61_000]);
    for (const t of times) {
      expect(times.filter((u) => u > t - 61_000 && u <= t).length).toBeLessThanOrEqual(5);
    }
  });

  it("frees a slot exactly when the oldest request leaves the window", async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(2, 60_000, clock);
    await limiter.acquire();
    clock.t = 30_000;
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.now()).toBe(60_000);
    await limiter.acquire();
    expect(clock.now()).toBe(90_000);
  });

  it("holds requests during a pause", async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(5, 60_000, clock);
    limiter.pause(8_000);
    await limiter.acquire();
    expect(clock.now()).toBe(8_000);
  });

  it("rejects a non-positive or fractional limit", () => {
    expect(() => new RateLimiter(0)).toThrow();
    expect(() => new RateLimiter(2.5)).toThrow();
  });
});
