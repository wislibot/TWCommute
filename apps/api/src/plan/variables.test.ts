import { PlanRequest } from "@twc/contracts";
import { describe, expect, it } from "vitest";
import { buildPlanVariables, minutesToDuration, toTaipeiIso } from "./variables";

describe("buildPlanVariables", () => {
  const now = new Date("2026-10-11T01:00:00Z");

  it("maps vias to visit locations with minimum wait time", () => {
    const vars = buildPlanVariables(
      PlanRequest.parse({
        from: { lat: 25.0478, lon: 121.517 },
        to: { lat: 25.1677, lon: 121.4456 },
        vias: [{ place: { lat: 25.0558, lon: 121.5099, label: "Dihua St" }, dwellMinutes: 90 }],
      }),
      now,
    );
    expect(vars.via).toEqual([
      {
        visit: { label: "Dihua St", minimumWaitTime: "PT90M", coordinate: { latitude: 25.0558, longitude: 121.5099 } },
      },
    ]);
    expect(vars.dateTime).toEqual({ earliestDeparture: "2026-10-11T09:00:00+08:00" });
  });

  it("uses rental modes only when bike share is on", () => {
    const on = buildPlanVariables(
      PlanRequest.parse({ from: { lat: 25, lon: 121.5 }, to: { lat: 25.1, lon: 121.5 } }),
      now,
    );
    const off = buildPlanVariables(
      PlanRequest.parse({ from: { lat: 25, lon: 121.5 }, to: { lat: 25.1, lon: 121.5 }, bikeShare: false }),
      now,
    );
    expect((on.modes as { direct: string[] }).direct).toEqual(["WALK", "BICYCLE_RENTAL"]);
    expect((off.modes as { direct: string[] }).direct).toEqual(["WALK"]);
  });

  it("routes from a stop when the place is pinned", () => {
    const vars = buildPlanVariables(
      PlanRequest.parse({ from: { lat: 25, lon: 121.5, stopId: "trtc:BL12" }, to: { lat: 25.1, lon: 121.5 } }),
      now,
    );
    expect(vars.origin).toEqual({ location: { stopLocation: { stopLocationId: "trtc:BL12" } } });
  });
});

describe("helpers", () => {
  it("formats durations and Taipei time", () => {
    expect(minutesToDuration(0)).toBe("PT0S");
    expect(minutesToDuration(45)).toBe("PT45M");
    expect(toTaipeiIso(new Date("2026-10-11T16:30:00Z"))).toBe("2026-10-12T00:30:00+08:00");
  });
});
