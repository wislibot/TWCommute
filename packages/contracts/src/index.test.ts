import { describe, expect, it } from "vitest";
import { MAX_VIAS, PlanRequest } from "./index";

const taipeiMain = { lat: 25.0478, lon: 121.517 };
const tamsui = { lat: 25.1677, lon: 121.4456 };

describe("PlanRequest", () => {
  it("applies defaults", () => {
    const req = PlanRequest.parse({ from: taipeiMain, to: tamsui });
    expect(req.vias).toEqual([]);
    expect(req.arriveBy).toBe(false);
    expect(req.bikeShare).toBe(true);
    expect(req.locale).toBe("en");
  });

  it("accepts via stops with dwell time", () => {
    const req = PlanRequest.parse({
      from: taipeiMain,
      to: tamsui,
      vias: [{ place: { lat: 25.0558, lon: 121.5099, label: "Dihua St" }, dwellMinutes: 90 }],
    });
    expect(req.vias[0]?.dwellMinutes).toBe(90);
  });

  it("rejects too many vias and negative dwell", () => {
    const via = { place: taipeiMain, dwellMinutes: 10 };
    expect(PlanRequest.safeParse({ from: taipeiMain, to: tamsui, vias: Array(MAX_VIAS + 1).fill(via) }).success).toBe(
      false,
    );
    expect(
      PlanRequest.safeParse({ from: taipeiMain, to: tamsui, vias: [{ place: taipeiMain, dwellMinutes: -1 }] }).success,
    ).toBe(false);
  });

  it("requires an offset on the time", () => {
    expect(PlanRequest.safeParse({ from: taipeiMain, to: tamsui, time: "2026-10-11T09:00:00" }).success).toBe(false);
    expect(PlanRequest.safeParse({ from: taipeiMain, to: tamsui, time: "2026-10-11T09:00:00+08:00" }).success).toBe(
      true,
    );
  });
});
