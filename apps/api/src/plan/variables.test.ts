import { PlanRequest } from "@twc/contracts";
import { describe, expect, it } from "vitest";
import { buildPlanVariables, searchVariables, toTaipeiIso } from "./variables";

describe("buildPlanVariables", () => {
  const now = new Date("2026-10-11T01:00:00Z");

  it("searches the whole trip from now, ignoring stops (planned per segment)", () => {
    const vars = buildPlanVariables(
      PlanRequest.parse({
        from: { lat: 25.0478, lon: 121.517 },
        to: { lat: 25.1677, lon: 121.4456 },
        vias: [{ place: { lat: 25.0558, lon: 121.5099, label: "Dihua St" }, dwellMinutes: 90 }],
      }),
      now,
    );
    expect(vars.via).toBeUndefined();
    expect(vars.dateTime).toEqual({ earliestDeparture: "2026-10-11T09:00:00+08:00" });
    expect(vars.destination).toEqual({ location: { coordinate: { latitude: 25.1677, longitude: 121.4456 } } });
  });

  it("builds one segment's search with its own endpoints, time and size", () => {
    const req = PlanRequest.parse({ from: { lat: 25, lon: 121.5 }, to: { lat: 25.1, lon: 121.5 }, locale: "zh-TW" });
    const vars = searchVariables(req, {
      from: { lat: 25.0558, lon: 121.5099, label: "Dihua St" },
      to: { lat: 25.1, lon: 121.5, stopId: "tw:TPE10002" },
      time: "2026-10-11T11:05:00+08:00",
      arriveBy: true,
      first: 10,
    });
    expect(vars).toMatchObject({
      origin: { label: "Dihua St", location: { coordinate: { latitude: 25.0558, longitude: 121.5099 } } },
      destination: { location: { stopLocation: { stopLocationId: "tw:TPE10002" } } },
      dateTime: { latestArrival: "2026-10-11T11:05:00+08:00" },
      first: 10,
      locale: "zh_TW",
    });
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
  it("formats Taipei time", () => {
    expect(toTaipeiIso(new Date("2026-10-11T16:30:00Z"))).toBe("2026-10-12T00:30:00+08:00");
  });
});

describe("tdxRouteKey", () => {
  it("splits TDX GTFS route ids into sub-route and direction", async () => {
    const { tdxRouteKey } = await import("../lib/ids");
    expect(tdxRouteKey("tw:TPE104710_0")).toEqual({ subRouteUid: "TPE104710", direction: 0 });
    expect(tdxRouteKey("tw:THB0968A2_1")).toEqual({ subRouteUid: "THB0968A2", direction: 1 });
    expect(tdxRouteKey("trtc:R")).toEqual({ subRouteUid: "R" });
    expect(tdxRouteKey(undefined)).toBeUndefined();
  });
});
