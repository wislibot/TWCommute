import { describe, expect, it } from "vitest";
import { busEtas } from "../test-fixtures";
import { BusEtaStore } from "./eta-store";

/** A stop's place on each variant, as `<SubRouteUID>|<Direction>` → stop_sequence. */
const at = (seqs: Record<string, number>) =>
  new Map(Object.entries(seqs).map(([key, seq]) => [key, { first: seq, last: seq }]));

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

  it("counts live predictions per feed (none = buses not running)", () => {
    const s = new BusEtaStore();
    s.replace("Taipei", busEtas);
    s.replace("Hsinchu", [{ StopUID: "HSZ1", RouteUID: "HSZ10", Direction: 0, StopStatus: 1 }]);
    expect(s.liveCounts()).toEqual({
      Taipei: busEtas.filter((r) => typeof r.EstimateTime === "number").length,
      Hsinchu: 0,
    });
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

describe("BusEtaStore when a variant reuses the route's own id (live TDX data)", () => {
  it("does not attach a Taipei route-level row to 685 when 685經吉林 also runs that way", () => {
    const store = new BusEtaStore();
    store.replace("Taipei", [{ StopUID: "TPE12478", RouteUID: "TPE10811", Direction: 0, EstimateTime: 120 }]);
    store.setRoutes("Taipei", [
      {
        RouteUID: "TPE10811",
        RouteID: "10811",
        RouteName: { Zh_tw: "685" },
        SubRoutes: [
          { SubRouteUID: "TPE10811", SubRouteID: "10811", Direction: 0 },
          { SubRouteUID: "TPE159203", SubRouteID: "159203", Direction: 0 },
        ],
      },
    ]);
    expect(store.find({ stopUid: "TPE12478", subRouteUid: "TPE10811", direction: 0 })).toBeNull();
    expect(store.find({ stopUid: "TPE12478", subRouteUid: "TPE159203", direction: 0 })).toBeNull();
  });

  it("matches rows that name their sub-route only to that sub-route (Taichung 105 / 105延)", () => {
    const store = new BusEtaStore();
    store.replace("Taichung", [
      { StopUID: "TXG1", RouteUID: "TXG105", SubRouteUID: "TXG105", Direction: 0, EstimateTime: 900 },
      { StopUID: "TXG1", RouteUID: "TXG105", SubRouteUID: "TXG1052", Direction: 0, EstimateTime: 120 },
    ]);
    expect(store.find({ stopUid: "TXG1", subRouteUid: "TXG105", direction: 0 })?.etaSeconds).toBe(900);
    expect(store.find({ stopUid: "TXG1", subRouteUid: "TXG1052", direction: 0 })?.etaSeconds).toBe(120);
  });
});

describe("BusEtaStore with the GTFS stop index", () => {
  const routes = [
    {
      RouteUID: "TPE10811",
      RouteID: "10811",
      RouteName: { Zh_tw: "685" },
      SubRoutes: [
        { SubRouteUID: "TPE10811", SubRouteID: "10811", Direction: 0 },
        { SubRouteUID: "TPE159203", SubRouteID: "159203", Direction: 0 },
      ],
    },
  ];
  const store = new BusEtaStore();
  store.setRoutes("Taipei", routes);
  store.replace("Taipei", [
    { StopUID: "SHARED", RouteUID: "TPE10811", Direction: 0, EstimateTime: 120 },
    { StopUID: "JILIN", RouteUID: "TPE10811", Direction: 0, EstimateTime: 300 },
  ]);
  // Both variants stop at SHARED; only 685經吉林 (TPE159203) stops at JILIN.
  store.setStopRoutes(
    new Map([
      ["SHARED", at({ "TPE10811|0": 3, "TPE159203|0": 3 })],
      ["JILIN", at({ "TPE159203|0": 9 })],
    ]),
  );

  it("matches a route-level row at a stop only one variant serves", () => {
    expect(store.find({ stopUid: "JILIN", subRouteUid: "TPE159203", direction: 0 })?.etaSeconds).toBe(300);
    expect(store.find({ stopUid: "JILIN", subRouteUid: "TPE10811", direction: 0 })).toBeNull();
  });

  it("still does not guess at a stop both variants serve", () => {
    expect(store.find({ stopUid: "SHARED", subRouteUid: "TPE10811", direction: 0 })).toBeNull();
    expect(store.find({ stopUid: "SHARED", subRouteUid: "TPE159203", direction: 0 })).toBeNull();
  });
});

describe("BusEtaStore for a trip leg at a stop several variants serve", () => {
  const store = new BusEtaStore();
  store.setRoutes("Taipei", [
    {
      RouteUID: "TPE10811",
      RouteID: "10811",
      RouteName: { Zh_tw: "685" },
      SubRoutes: [
        { SubRouteUID: "TPE10811", SubRouteID: "10811", Direction: 0 },
        { SubRouteUID: "TPE159203", SubRouteID: "159203", Direction: 0 },
      ],
    },
  ]);
  store.replace("Taipei", [{ StopUID: "SHARED", RouteUID: "TPE10811", Direction: 0, EstimateTime: 120 }]);
  store.setStopRoutes(
    new Map([
      ["SHARED", at({ "TPE10811|0": 3, "TPE159203|0": 3 })],
      ["BOTH_LATER", at({ "TPE10811|0": 12, "TPE159203|0": 20 })],
      ["JILIN", at({ "TPE159203|0": 9 })],
      // 685 passes EARLIER (stop 1) before SHARED; 685經吉林 reaches it only after (stop 25).
      ["EARLIER", at({ "TPE10811|0": 1, "TPE159203|0": 25 })],
    ]),
  );

  it("uses the route's next bus when every variant here also stops where the rider gets off", () => {
    const q = { stopUid: "SHARED", subRouteUid: "TPE10811", direction: 0, toStopUid: "BOTH_LATER" };
    expect(store.find(q)?.etaSeconds).toBe(120);
  });

  it("does not when a variant passes the rider's stop only before the boarding stop", () => {
    expect(store.find({ stopUid: "SHARED", subRouteUid: "TPE159203", direction: 0, toStopUid: "EARLIER" })).toBeNull();
  });

  it("does not when only some variants go there, or without the alighting stop", () => {
    expect(store.find({ stopUid: "SHARED", subRouteUid: "TPE159203", direction: 0, toStopUid: "JILIN" })).toBeNull();
    expect(store.find({ stopUid: "SHARED", subRouteUid: "TPE10811", direction: 0 })).toBeNull();
  });
});
