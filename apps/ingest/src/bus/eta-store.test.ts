import { describe, expect, it } from "vitest";
import { busEtas } from "../test-fixtures";
import { BusEtaStore } from "./eta-store";

describe("BusEtaStore", () => {
  const store = new BusEtaStore();
  store.replace("Taipei", busEtas);

  it("returns all routes at a stop", () => {
    expect(store.atStop("TPE10001")).toHaveLength(3);
    expect(store.atStop("NOPE")).toEqual([]);
  });

  it("filters by direction and sub-route", () => {
    expect(store.find({ stopUid: "TPE10001", routeUid: "TPE10307", direction: 0 })?.etaSeconds).toBe(420);
    expect(store.find({ stopUid: "TPE10001", subRouteUid: "TPE103071" })?.etaSeconds).toBe(90);
  });

  it("prefers the soonest prediction when direction is unknown", () => {
    expect(store.find({ stopUid: "TPE10001", routeUid: "TPE10307" })?.etaSeconds).toBe(90);
  });

  it("keeps non-running statuses with a null ETA", () => {
    expect(store.find({ stopUid: "TPE10001", routeUid: "TPE10235" })).toMatchObject({
      etaSeconds: null,
      stopStatus: 3,
    });
  });

  it("replaces a feed atomically", () => {
    const s = new BusEtaStore();
    s.replace("Taipei", busEtas);
    s.replace("Taipei", []);
    expect(s.size()).toBe(0);
  });
});

describe("BusEtaStore sub-route keys (TDX GTFS route_id = <SubRouteUID>_<Direction>)", () => {
  const store = new BusEtaStore();
  store.replace("Kaohsiung", [
    { StopUID: "KHH1", RouteUID: "KHH100", SubRouteUID: "KHH1001", Direction: 0, EstimateTime: 120 },
    { StopUID: "KHH1", RouteUID: "KHH100", Direction: 1, EstimateTime: 30 },
  ]);
  it("matches the sub-route, or the route when TDX has no separate sub-route", () => {
    expect(store.find({ stopUid: "KHH1", subRouteUid: "KHH1001", direction: 0 })?.etaSeconds).toBe(120);
    expect(store.find({ stopUid: "KHH1", subRouteUid: "KHH100", direction: 1 })?.etaSeconds).toBe(30);
    expect(store.find({ stopUid: "KHH1", subRouteUid: "KHH1001", direction: 1 })).toBeNull();
  });
});

describe("BusEtaStore parent routes (ETA rows without SubRouteUID)", () => {
  const store = new BusEtaStore();
  store.replace("Taipei", [{ StopUID: "TPE1", RouteUID: "TPE10471", Direction: 0, EstimateTime: 240 }]);
  it("cannot match a sub-route key before the route list is known", () => {
    expect(store.find({ stopUid: "TPE1", subRouteUid: "TPE104710", direction: 0 })).toBeNull();
  });
  it("matches through the sub-route's parent route once routes are loaded", () => {
    store.setRoutes("Taipei", [
      {
        RouteUID: "TPE10471",
        RouteID: "10471",
        RouteName: {},
        SubRoutes: [{ SubRouteUID: "TPE104710", SubRouteID: "104710" }],
      },
    ]);
    expect(store.find({ stopUid: "TPE1", subRouteUid: "TPE104710", direction: 0 })?.etaSeconds).toBe(240);
    expect(store.find({ stopUid: "TPE1", subRouteUid: "TPE104710", direction: 1 })).toBeNull();
    expect(store.find({ stopUid: "TPE1", subRouteUid: "TPE999990", direction: 0 })).toBeNull();
  });
});
