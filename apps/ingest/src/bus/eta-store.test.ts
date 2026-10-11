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
