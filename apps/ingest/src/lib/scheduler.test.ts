import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthRegistry } from "./health";
import { nextDelayMs, Scheduler } from "./scheduler";

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

describe("nextDelayMs", () => {
  it("waits the rest of the interval after a success", () => {
    expect(nextDelayMs(60_000, 5_000, 0)).toBe(55_000);
    expect(nextDelayMs(60_000, 90_000, 0)).toBe(0);
  });

  it("backs off from 60 s, doubling, capped at the interval", () => {
    const twelveHours = 12 * 3600_000;
    expect([1, 2, 3, 4].map((n) => nextDelayMs(twelveHours, 0, n))).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(nextDelayMs(twelveHours, 0, 30)).toBe(twelveHours);
    // A job that runs every minute never retries faster than that.
    expect(nextDelayMs(60_000, 0, 3)).toBe(60_000);
  });
});

describe("Scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a failed long-interval job after a minute instead of the full interval", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockRejectedValueOnce(new Error("TDX 503")).mockResolvedValue(undefined);
    const s = new Scheduler(new HealthRegistry(), quiet);
    s.add({ name: "bus-routes:Taipei", intervalMs: 12 * 3600_000, run });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    // After the success it is back on its 12-hour cycle.
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(run).toHaveBeenCalledTimes(2);
    s.stop();
  });
});
