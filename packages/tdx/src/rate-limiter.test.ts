import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter";
import { FakeClock } from "./test-utils";

describe("RateLimiter", () => {
  it("allows a burst, then spaces requests at the configured rate", async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(5, 5, clock);
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      await limiter.acquire();
      times.push(clock.now());
    }
    expect(times.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    // After the burst, one token every 200 ms.
    expect(times[9]).toBe(1000);
  });

  it("rejects a non-positive rate", () => {
    expect(() => new RateLimiter(0)).toThrow();
  });
});
