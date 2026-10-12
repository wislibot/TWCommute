import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildBusStopRoutes, loadGtfsIndexes } from "./indexes";

const files = {
  agency: "agency_id,agency_name\nTPE,臺北市公車\nTRA,臺鐵\n",
  routes:
    "route_id,agency_id,route_type\nTPE10811_0,TPE,3\nTPE159203_0,TPE,3\nTPE159203_1,TPE,3\nTRA_1004_0_1132,TRA,2\n",
  trips:
    "route_id,service_id,trip_id\nTPE10811_0,D,A1\nTPE159203_0,D,B1\nTPE159203_1,D,B2\nTRA_1004_0_1132,D,TRA_1004_0_1132_20261012_102700\n",
  stops: "stop_id\nSHARED\nJILIN\nTRA_0930\n",
};
const stopTimes =
  "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
  "A1,08:00:00,08:00:00,SHARED,1\nB1,08:05:00,08:05:00,SHARED,1\nB1,08:10:00,08:10:00,JILIN,2\n" +
  "B2,09:00:00,09:00:00,JILIN,1\nTRA_1004_0_1132_20261012_102700,10:27:00,10:27:00,TRA_0930,1\n";

describe("bus stop index", () => {
  it("lists the bus sub-routes and directions stopping at each stop, leaving out rail", () => {
    const idx = buildBusStopRoutes(files, strToU8(stopTimes));
    expect([...(idx.get("SHARED")?.keys() ?? [])].sort()).toEqual(["TPE10811|0", "TPE159203|0"]);
    expect(idx.get("JILIN")).toEqual(
      new Map([
        ["TPE159203|0", { first: 2, last: 2 }],
        ["TPE159203|1", { first: 1, last: 1 }],
      ]),
    );
    expect(idx.has("TRA_0930")).toBe(false);
  });

  it("builds the TRA and bus indexes from one zip", () => {
    const zip = zipSync({
      ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`${k}.txt`, strToU8(v)])),
      "stop_times.txt": strToU8(stopTimes),
    });
    const { tra, busStopRoutes } = loadGtfsIndexes(zip);
    expect(tra.tripIdsByTrainNo.get("1004")).toEqual(["TRA_1004_0_1132_20261012_102700"]);
    expect(tra.stopsByTripId.get("TRA_1004_0_1132_20261012_102700")).toHaveLength(1);
    expect(busStopRoutes.size).toBe(2);
  });
});
