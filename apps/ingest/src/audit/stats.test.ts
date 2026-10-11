import { describe, expect, it } from "vitest";
import { ageSeconds, countBy, pct, percentiles, topN } from "./stats";

describe("audit stats", () => {
  it("computes percentages and handles empty denominators", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(0, 0)).toBeNull();
  });
  it("computes nearest-rank percentiles", () => {
    expect(percentiles([5, 1, 3, 2, 4, Number.NaN])).toEqual({ count: 5, p50: 3, p90: 5, max: 5 });
    expect(percentiles([])).toEqual({ count: 0, p50: null, p90: null, max: null });
  });
  it("counts, ranks and ages", () => {
    expect(
      topN(
        countBy(["a", "b", "a", "c", "a", "b"], (x) => x),
        2,
      ),
    ).toEqual({ a: 3, b: 2 });
    expect(ageSeconds("2026-10-11T09:00:00+08:00", Date.parse("2026-10-11T01:01:30Z"))).toBe(90);
    expect(ageSeconds("bad", 0)).toBeNull();
  });
});
