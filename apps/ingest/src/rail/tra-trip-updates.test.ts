import { strToU8, zipSync } from "fflate";
import GtfsRealtime from "gtfs-realtime-bindings";
import { describe, expect, it } from "vitest";
import { buildTraIndex, buildTraIndexFromZip } from "../gtfs/tra-index";
import { buildTraTripUpdates, taipeiServiceDate, tripsForNow } from "./tra-trip-updates";

const files = {
  agency:
    "agency_id,agency_name,agency_url,agency_timezone\nTRA,臺鐵,https://example.test,Asia/Taipei\nTRTC,臺北捷運,https://example.test,Asia/Taipei\n",
  routes: "route_id,agency_id,route_short_name,route_type\nTRA-WEST,TRA,西部幹線,2\nBL,TRTC,板南線,1\n",
  trips:
    "route_id,service_id,trip_id,trip_short_name\nTRA-WEST,WK,TRA-123-WK,123\nTRA-WEST,WE,TRA-123-WE,123\nBL,WK,BL-1,123\n",
  stops:
    "stop_id,stop_code,stop_name,stop_lat,stop_lon\nTRA_1000,1000,臺北,25.04,121.51\nTRA_1020,,板橋,25.01,121.46\n",
};

describe("buildTraIndex", () => {
  it("indexes only TRA trips by train number", () => {
    const idx = buildTraIndex(files);
    expect(idx.tripIdsByTrainNo.get("123")).toEqual(["TRA-123-WK", "TRA-123-WE"]);
  });

  it("maps station ids via stop_code or trailing digits", () => {
    const idx = buildTraIndex(files);
    expect(idx.stopIdByStationId.get("1000")).toBe("TRA_1000");
    expect(idx.stopIdByStationId.get("1020")).toBe("TRA_1020");
  });

  it("finds the TRA feed inside a bundle of nested zips", () => {
    const inner = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [`${k}.txt`, strToU8(v)])));
    const other = zipSync({ "agency.txt": strToU8("agency_id,agency_name\nX,Bus\n") });
    const bundle = zipSync({ "tra.zip": inner, "bus.zip": other });
    expect(buildTraIndexFromZip(bundle).tripIdsByTrainNo.get("123")).toHaveLength(2);
  });
});

describe("buildTraTripUpdates", () => {
  const index = buildTraIndex(files);
  const now = Date.parse("2026-10-11T23:30:00+08:00");

  it("encodes delays as stop-time updates on every matching trip", () => {
    const result = buildTraTripUpdates(
      [
        { TrainNo: "123", StationID: "1000", DelayTime: 4 },
        { TrainNo: "999", StationID: "1000", DelayTime: 2 },
        { TrainNo: "123", StationID: "7777", DelayTime: 1 },
      ],
      index,
      now,
    );
    expect(result).toMatchObject({ matched: 1, unmatchedTrains: 1, unmatchedStations: 1 });

    const { FeedMessage } = GtfsRealtime.transit_realtime;
    const decoded = FeedMessage.toObject(FeedMessage.decode(result.feed), { longs: Number }) as {
      entity: Array<{
        tripUpdate: {
          trip: { tripId: string; startDate: string };
          stopTimeUpdate: Array<{ stopId: string; departure: { delay: number } }>;
        };
      }>;
    };
    expect(decoded.entity).toHaveLength(2);
    expect(decoded.entity[0]?.tripUpdate.trip).toMatchObject({ tripId: "TRA-123-WK", startDate: "20261011" });
    expect(decoded.entity[0]?.tripUpdate.stopTimeUpdate[0]).toMatchObject({
      stopId: "TRA_1000",
      departure: { delay: 240 },
    });
  });

  it("uses the Taipei service date", () => {
    expect(taipeiServiceDate(Date.parse("2026-10-11T17:00:00Z"))).toBe("20261012");
  });
});

describe("TDX TRA feed layout", () => {
  // Synthetic rows in the layout of the real TDX national GTFS (Phase 0 audit).
  const tdx = buildTraIndex({
    agency: "agency_id,agency_name\nTRA,交通部臺灣鐵路管理局\nTPE,臺北市公車\n",
    routes: "route_id,agency_id,route_type\nTRA_1004_0_1132,TRA,2\nTPE10001_0,TPE,3\n",
    trips:
      "route_id,service_id,trip_id\nTRA_1004_0_1132,S1,TRA_1004_0_1132_20261011_102700\nTRA_1004_0_1132,S2,TRA_1004_0_1132_20261012_102700\nTPE10001_0,B,TPE-trip\n",
    stops: "stop_id,stop_name\nTPE10930,bus stop ending in 0930\nTRA_0930,七堵\n",
  });

  it("reads train numbers from route ids and indexes only TRA_ stops", () => {
    expect(tdx.tripIdsByTrainNo.get("1004")).toHaveLength(2);
    expect(tdx.stopIdByStationId.get("0930")).toBe("TRA_0930");
    expect(tdx.stopIdByStationId.size).toBe(1);
  });

  it("updates only the trip for the current service day", () => {
    const r = buildTraTripUpdates(
      [{ TrainNo: "1004", StationID: "0930", DelayTime: 2 }],
      tdx,
      Date.parse("2026-10-12T09:00:00+08:00"),
    );
    const { FeedMessage } = GtfsRealtime.transit_realtime;
    const ids = (
      FeedMessage.toObject(FeedMessage.decode(r.feed)) as {
        entity: Array<{ tripUpdate: { trip: { tripId: string; startDate: string } } }>;
      }
    ).entity.map((e) => e.tripUpdate.trip);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatchObject({ tripId: "TRA_1004_0_1132_20261012_102700", startDate: "20261012" });
  });
});

describe("tripsForNow", () => {
  const ids = ["T_20261011_235000", "T_20261012_235000"];
  it("prefers yesterday's trip for overnight trains before 04:00", () => {
    expect(tripsForNow(ids, Date.parse("2026-10-12T01:00:00+08:00"))).toEqual([
      { tripId: "T_20261011_235000", startDate: "20261011" },
    ]);
    expect(tripsForNow(ids, Date.parse("2026-10-12T05:00:00+08:00"))).toEqual([
      { tripId: "T_20261012_235000", startDate: "20261012" },
    ]);
  });
  it("returns nothing when the train does not run today or yesterday", () => {
    expect(tripsForNow(["T_20261020_080000"], Date.parse("2026-10-12T09:00:00+08:00"))).toEqual([]);
  });
});
