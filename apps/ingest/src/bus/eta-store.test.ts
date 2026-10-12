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

describe("BusEtaStore parent fallback needs a single variant per direction", () => {
  const sub = (SubRouteUID: string, Direction?: number) => ({
    SubRouteUID,
    SubRouteID: SubRouteUID.slice(3),
    ...(Direction === undefined ? {} : { Direction }),
  });
  const store = new BusEtaStore();
  store.replace("Taipei", [
    { StopUID: "TPE1", RouteUID: "TPE10307", Direction: 0, EstimateTime: 300 },
    { StopUID: "TPE1", RouteUID: "TPE10307", Direction: 1, EstimateTime: 60 },
  ]);
  store.setRoutes("Taipei", [
    {
      RouteUID: "TPE10307",
      RouteID: "10307",
      RouteName: {},
      // Outbound has a main line and a short-turn variant; inbound only the main line.
      SubRoutes: [sub("TPE103070", 0), sub("TPE103071", 0), sub("TPE103070", 1)],
    },
  ]);
  it("does not guess between variants in the same direction", () => {
    expect(store.find({ stopUid: "TPE1", subRouteUid: "TPE103070", direction: 0 })).toBeNull();
    expect(store.find({ stopUid: "TPE1", subRouteUid: "TPE103071", direction: 0 })).toBeNull();
  });
  it("matches the only variant in the other direction", () => {
    expect(store.find({ stopUid: "TPE1", subRouteUid: "TPE103070", direction: 1 })?.etaSeconds).toBe(60);
  });
  it("counts sub-routes without a direction in every direction", () => {
    const s = new BusEtaStore();
    s.replace("Taipei", [{ StopUID: "TPE1", RouteUID: "TPE1", Direction: 1, EstimateTime: 10 }]);
    s.setRoutes("Taipei", [
      { RouteUID: "TPE1", RouteID: "1", RouteName: {}, SubRoutes: [sub("TPE11"), sub("TPE12", 1)] },
    ]);
    expect(s.find({ stopUid: "TPE1", subRouteUid: "TPE12", direction: 1 })).toBeNull();
  });
});
