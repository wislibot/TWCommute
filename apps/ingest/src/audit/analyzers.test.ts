/** Analyzer tests on small synthetic fixtures (not real TDX data). */
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildTraIndex } from "../gtfs/tra-index";
import { buildTraTripUpdates } from "../rail/tra-trip-updates";
import { analyzeBusMapping, analyzeEtaQuality } from "./bus-mapping";
import { analyzeCityPrefixes, buildGtfsIdIndex, profileFeed } from "./gtfs-profile";
import { analyzeTra } from "./tra-audit";
import { analyzeYouBike } from "./youbike-audit";

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

/** Patch an entry's compression method in the central directory so inflating it would throw. */
function poison(data: Uint8Array, name: string): Uint8Array {
  const out = data.slice();
  const target = strToU8(name);
  for (let i = 0; i < out.length - 46; i++) {
    if (out[i] === 0x50 && out[i + 1] === 0x4b && out[i + 2] === 0x01 && out[i + 3] === 0x02) {
      const len = (out[i + 28] ?? 0) | ((out[i + 29] ?? 0) << 8);
      const entry = out.subarray(i + 46, i + 46 + len);
      if (entry.length === target.length && entry.every((b, k) => b === target[k])) {
        out[i + 10] = 99;
        out[i + 11] = 0;
      }
    }
  }
  return out;
}

const STOP_TIMES = "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,TPE1,1\n";
const feedFiles = {
  "feed/agency.txt": "agency_id,agency_name\nTPE,臺北市公車\n",
  "feed/routes.txt":
    "route_id,agency_id,route_short_name,route_type\nTPE10307,TPE,307,3\nTPE10235,TPE,235,3\nR,TRTC,紅線,1\n",
  "feed/trips.txt": "route_id,service_id,trip_id\nTPE10307,WK,T1\nTPE10307,WK,T1\nTPE10235,WE,T2\n",
  "feed/stops.txt":
    '﻿stop_id,stop_code,stop_name,location_type\r\nTPE1,,"Main, St",\r\nnwt2,X9,B,\r\n1001,,臺北,1\r\n,,blank,\r\nTPE1,,dup,\r\n',
  "feed/stop_times.txt": STOP_TIMES,
  "feed/shapes.txt": "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nS,25,121,1\n",
  "feed/calendar.txt": "service_id,start_date,end_date\nWK,20261001,20261231\nWE,20261005,bad\n",
  "feed/calendar_dates.txt": "service_id,date,exception_type\nXMAS,20270105,1\nWK,20260901,2\n",
  "feed/frequencies.txt": "trip_id,start_time,end_time,headway_secs\nT2,06:00:00,23:00:00,600\n",
  "feed/translations.txt":
    "table_name,field_name,language,translation,record_id\nstops,stop_name,en,Taipei,1001\nstops,stop_name,ja,台北,1001\n",
};

describe("profileFeed", () => {
  const data = poison(poison(zip(feedFiles), "feed/stop_times.txt"), "feed/shapes.txt");
  const p = profileFeed({ feedId: "tw", fileName: "tw.gtfs.zip", data });

  it("profiles files without inflating stop_times or shapes", () => {
    expect(p.stopTimesBytes).toBe(strToU8(STOP_TIMES).length);
    expect(p.hasShapes && p.hasFrequencies && p.hasTranslations).toBe(true);
    expect(p.files).toContain("stop_times.txt");
  });

  it("counts distinct ids and summarizes the calendar", () => {
    expect(p.routeCount).toBe(3);
    expect(p.routeTypeCounts).toEqual({ "3": 2, "1": 1 });
    expect(p.tripCount).toBe(2);
    expect(p.stopCount).toBe(3);
    expect(p.stationCount).toBe(1);
    expect(p.calendar).toEqual({ start: "20261001", end: "20270105", serviceIds: 3 });
    expect(p.translationLanguages).toEqual(["en", "ja"]);
    expect(p.idSamples.stop).toEqual(["TPE1", "nwt2", "1001"]);
    expect(p.warnings.join(" ")).toMatch(/duplicate trip_id/);
    expect(p.warnings.join(" ")).toMatch(/rows without stop_id/);
    expect(p.warnings.join(" ")).toMatch(/invalid dates/);
    expect(p.warnings.join(" ")).toMatch(/frequencies/);
  });

  it("never throws on junk or empty input", () => {
    expect(profileFeed({ feedId: "x", fileName: "x", data: strToU8("not a zip") }).warnings.join(" ")).toMatch(
      /unreadable zip/,
    );
    const empty = profileFeed({ feedId: "e", fileName: "e", data: zipSync({}) });
    expect(empty.calendar).toEqual({ start: null, end: null, serviceIds: 0 });
    expect(empty.stopTimesBytes).toBeNull();
  });
});

describe("GTFS id index and city prefixes", () => {
  const data = zip(feedFiles);
  it("unions ids across feeds, skipping blanks", () => {
    const idx = buildGtfsIdIndex([{ data }, { data: zip({ "stops.txt": "stop_id,stop_code\nKHH9,\n" }) }]);
    expect([...idx.stopIds].sort()).toEqual(["1001", "KHH9", "TPE1", "nwt2"]);
    expect([...idx.stopCodes]).toEqual(["X9"]);
    expect(idx.routeShortNames.has("307")).toBe(true);
  });
  it("resolves TDX city codes case-insensitively", () => {
    const r = analyzeCityPrefixes({ feedId: "tw", data });
    expect(r).toMatchObject({
      stops: 3,
      resolved: 66.7,
      byCity: { Taipei: 1, NewTaipei: 1 },
      unresolvedSamples: ["1001"],
    });
    expect(analyzeCityPrefixes({ feedId: "e", data: zipSync({}) }).resolved).toBeNull();
  });
});

describe("analyzeBusMapping", () => {
  const index = buildGtfsIdIndex([{ data: zip(feedFiles) }]);
  const stop = (StopUID: string, StopID: string) => ({
    StopUID,
    StopID,
    StopName: {},
    StopPosition: { PositionLat: 25, PositionLon: 121 },
  });
  const route = (RouteUID: string, subs: string[]) => ({
    RouteUID,
    RouteID: RouteUID.slice(3),
    RouteName: {},
    SubRoutes: subs.map((s) => ({ SubRouteUID: s, SubRouteID: s })),
  });

  it("measures each id hypothesis and picks the best", () => {
    const r = analyzeBusMapping(
      "Taipei",
      index,
      [stop("TPE1", "1"), stop("TPE1", "1"), stop("TPE404", "404")],
      [route("TPE10307", ["TPE103070"]), route("TPE10999", [])],
      [
        { StopUID: "TPE1", RouteUID: "TPE10307", Direction: 0 },
        { StopUID: "TPE1", RouteUID: "TPE10307", Direction: 0 },
        { StopUID: "TPE404", RouteUID: "TPE10307", Direction: 1 },
      ],
    );
    expect(r).toMatchObject({
      tdxStops: 2,
      stopUidInGtfs: 50,
      stopIdInGtfs: 0,
      tdxRoutes: 2,
      routeUidInGtfs: 50,
      subRouteUidInGtfs: 0,
      etaRows: 2,
      etaJoinable: 50,
    });
    expect(r.bestHypothesis).toBe("StopUID=stop_id (50%), RouteUID=route_id (50%)");
    expect(r.samples.unmatchedEtaKeys).toEqual(["TPE404|TPE10307"]);
  });

  it("recognises the TDX layout route_id = <SubRouteUID>_<Direction>", () => {
    const idx = buildGtfsIdIndex([
      { data: zip({ "stops.txt": "stop_id\nTPE1\n", "routes.txt": "route_id\nTPE104710_0\nTPE104710_1\n" }) },
    ]);
    const r = analyzeBusMapping(
      "Taipei",
      idx,
      [stop("TPE1", "1")],
      [
        {
          RouteUID: "TPE10471",
          RouteID: "10471",
          RouteName: {},
          SubRoutes: [
            { SubRouteUID: "TPE104710", SubRouteID: "104710", Direction: 0 },
            { SubRouteUID: "TPE104710", SubRouteID: "104710", Direction: 1 },
          ],
        },
      ],
      [
        { StopUID: "TPE1", RouteUID: "TPE10471", SubRouteUID: "TPE104710", Direction: 1 },
        { StopUID: "TPE1", RouteUID: "TPE10471", Direction: 0 },
      ],
    );
    // The row without SubRouteUID joins through its parent route (Taipei/New Taipei feeds).
    expect(r).toMatchObject({
      routeUidInGtfs: 0,
      subRouteUidInGtfs: 0,
      subRouteDirInGtfs: 100,
      etaWithSubRoute: 50,
      etaJoinable: 100,
    });
    expect(r.bestHypothesis).toContain("SubRouteUID_Direction=route_id (100%)");
  });

  it("counts each sub-route direction and skips route-level rows with several variants", () => {
    const idx = buildGtfsIdIndex([
      {
        data: zip({
          "stops.txt": "stop_id\nTPE1\n",
          "routes.txt": "route_id\nTPE103070_0\nTPE103071_0\nTPE103070_1\n",
        }),
      },
    ]);
    const sub = (SubRouteUID: string, Direction: number) => ({ SubRouteUID, SubRouteID: SubRouteUID, Direction });
    const r = analyzeBusMapping(
      "Taipei",
      idx,
      [stop("TPE1", "1")],
      [
        {
          RouteUID: "TPE10307",
          RouteID: "10307",
          RouteName: {},
          SubRoutes: [sub("TPE103070", 0), sub("TPE103071", 0), sub("TPE103070", 1), sub("TPE103072", 1)],
        },
      ],
      [
        { StopUID: "TPE1", RouteUID: "TPE10307", Direction: 0 },
        { StopUID: "TPE1", RouteUID: "TPE10307", SubRouteUID: "TPE103071", Direction: 0 },
      ],
    );
    // 3 of the 4 (sub-route, direction) pairs are GTFS routes; the outbound route-level row is ambiguous.
    expect(r).toMatchObject({ subRouteDirInGtfs: 75, etaRows: 2, etaJoinable: 50 });
    expect(r.samples.unmatchedEtaKeys).toEqual(["TPE1|TPE10307"]);
  });

  it("returns null percentages for empty inputs and tolerates junk rows", () => {
    const r = analyzeBusMapping("X", index, [null as never], [], []);
    expect(r).toMatchObject({ tdxStops: 0, stopUidInGtfs: null, etaJoinable: null });
    expect(r.bestHypothesis).toBe("stops: none (<5%), routes: none (<5%)");
  });
});

describe("analyzeEtaQuality", () => {
  it("summarizes estimates, statuses and data age", () => {
    const now = Date.parse("2026-10-11T09:01:00+08:00");
    const r = analyzeEtaQuality(
      "Taipei",
      [
        {
          StopUID: "A",
          RouteUID: "R",
          Direction: 0,
          EstimateTime: 60,
          StopStatus: 0,
          SrcUpdateTime: "2026-10-11T09:00:00+08:00",
        },
        {
          StopUID: "B",
          RouteUID: "R",
          Direction: 0,
          EstimateTime: null,
          StopStatus: 3,
          UpdateTime: "2026-10-11T09:00:30+08:00",
        },
        { StopUID: "B", RouteUID: "Q", Direction: 0 },
      ],
      now,
    );
    expect(r).toMatchObject({
      rows: 3,
      distinctStops: 2,
      distinctRoutes: 2,
      withEstimate: 33.3,
      stopStatus: { "0": 1, "3": 1, missing: 1 },
    });
    expect(r.lagSeconds).toEqual({ count: 2, p50: 30, p90: 60, max: 60 });
  });
});

describe("analyzeTra", () => {
  const files = {
    agency: "agency_id,agency_name\nTRA,臺鐵\n",
    routes: "route_id,agency_id,route_type\nW,TRA,2\n",
    trips: "route_id,service_id,trip_id,trip_short_name\nW,WK,T123,123\nW,WK,T456,456\n",
    stops: "stop_id,stop_code\nTRA_1000,1000\n",
  };
  const index = buildTraIndex(files);
  const delays = [
    { TrainNo: "123", StationID: "1000", DelayTime: 3, SrcUpdateTime: "2026-10-11T09:00:00+08:00" },
    { TrainNo: " 123 ", StationID: "9999", DelayTime: 5, SrcUpdateTime: "2026-10-11T08:00:00+08:00" },
    { TrainNo: "456", StationID: "9999", DelayTime: 0 },
    { TrainNo: "777", StationID: "1000", DelayTime: 1 },
  ];
  const stations = [
    {
      StationUID: "TRA-1000",
      StationID: "1000",
      StationName: {},
      StationPosition: { PositionLat: 25, PositionLon: 121 },
    },
    {
      StationUID: "TRA-9999",
      StationID: "9999",
      StationName: {},
      StationPosition: { PositionLat: 25, PositionLon: 121 },
    },
  ];

  it("dedupes by train (latest wins) and classifies like the production mapper", () => {
    const r = analyzeTra(index, delays, stations);
    expect(r).toMatchObject({
      traFeedFound: true,
      delays: 3,
      matched: 1,
      unmatchedTrains: 1,
      unmatchedStations: 1,
      tdxStations: 2,
      tdxStationsMapped: 50,
    });
    expect(r.unmatchedSamples).toEqual({ trains: ["777"], stations: ["9999"] });
  });

  it("agrees with buildTraTripUpdates on deduplicated input", () => {
    const deduped = [delays[0], delays[2], delays[3]] as typeof delays;
    const prod = buildTraTripUpdates(deduped, index);
    const r = analyzeTra(index, deduped, stations);
    expect([r.matched, r.unmatchedTrains, r.unmatchedStations]).toEqual([
      prod.matched,
      prod.unmatchedTrains,
      prod.unmatchedStations,
    ]);
  });

  it("reports a missing TRA feed", () => {
    expect(analyzeTra(null, delays, stations)).toMatchObject({
      traFeedFound: false,
      matched: 0,
      unmatchedTrains: 3,
      tdxStationsMapped: null,
    });
  });
});

describe("analyzeYouBike", () => {
  const station = (uid: string, ServiceType: 1 | 2 | 3) => ({
    StationUID: uid,
    StationID: uid,
    StationName: {},
    StationPosition: { PositionLat: 25, PositionLon: 121 },
    ServiceType,
  });
  const now = Date.parse("2026-10-11T09:02:00+08:00");
  it("measures joins, statuses, empties and data age", () => {
    const r = analyzeYouBike(
      "Taipei",
      [station("A", 2), station("B", 2), station("C", 3), station("A", 2)],
      [
        {
          StationUID: "A",
          StationID: "A",
          ServiceStatus: 1,
          ServiceType: 2,
          AvailableRentBikes: 0,
          AvailableReturnBikes: 0,
          AvailableRentBikesDetail: { GeneralBikes: 0, ElectricBikes: 0 },
          SrcUpdateTime: "2026-10-11T09:00:00+08:00",
        },
        {
          StationUID: "A",
          StationID: "A",
          ServiceStatus: 1,
          ServiceType: 2,
          AvailableRentBikes: 4,
          AvailableReturnBikes: 9,
          SrcUpdateTime: "2026-10-11T08:00:00+08:00",
        },
        {
          StationUID: "C",
          StationID: "C",
          ServiceStatus: 1,
          ServiceType: 3,
          AvailableRentBikes: 2,
          SrcUpdateTime: "2026-10-11T09:01:00+08:00",
        },
        {
          StationUID: "Z",
          StationID: "Z",
          ServiceStatus: 2,
          ServiceType: 2,
          AvailableRentBikes: 1,
          AvailableReturnBikes: 3,
        },
      ],
      now,
    );
    expect(r).toMatchObject({
      stations: 3,
      availabilityRows: 3,
      joined: 66.7,
      serviceTypes: { youbike2: 2, moovo: 1 },
      statusCounts: { active: 2, suspended: 1 },
      withEbikeDetail: 33.3,
      zeroBikes: 50,
      zeroDocks: 100,
    });
    expect(r.lagSeconds).toEqual({ count: 2, p50: 60, p90: 120, max: 120 });
  });
});
