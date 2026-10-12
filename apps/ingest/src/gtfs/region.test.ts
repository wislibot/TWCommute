import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { cleanFeed } from "./prepare-otp";
import { GREATER_TAIPEI, parseBBox } from "./region";

const box = parseBBox(GREATER_TAIPEI);

// Taipei Main (inside), Banqiao (inside), Taichung (outside), Kaohsiung (outside).
const files = {
  "agency.txt": "agency_id,agency_name\nTRA,臺鐵\nTPE,臺北市公車\nKHH,高雄市公車\n",
  "routes.txt": "route_id,agency_id,route_type\nTRA_1_0_1,TRA,2\nTPE1_0,TPE,3\nKHH1_0,KHH,3\n",
  "stops.txt":
    "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n" +
    "ST,臺北,25.0478,121.517,1,\nTRA_1000,臺北,25.0478,121.517,0,ST\nE1,出口1,25.0479,121.5171,2,ST\n" +
    "TRA_1020,板橋,25.0143,121.4637,0,\nTRA_3300,臺中,24.1369,120.6851,0,\nKHH1,高雄,22.6394,120.3025,0,\n" +
    "KHH2,高雄2,22.64,120.31,0,\nTPE1,台北車站,25.046,121.517,0,\nTPE2,西門,25.042,121.508,0,\n" +
    // Banqiao station's internals: an entrance, a node without coordinates, a platform no trip uses.
    "BQ,板橋車站,25.0143,121.4637,1,\nBQ_E,出口,25.0144,121.4638,2,BQ\nBQ_N,,,,3,BQ\nBQ_P,月台,25.0143,121.4637,0,BQ\n",
  "pathways.txt":
    "pathway_id,from_stop_id,to_stop_id,pathway_mode,is_bidirectional\nP1,BQ_E,BQ_N,1,1\nP2,BQ_N,BQ_P,2,1\n",
  "trips.txt": "route_id,service_id,trip_id,shape_id\nTRA_1_0_1,S1,T1,SH_T\nTPE1_0,S2,B1,SH_B\nKHH1_0,S3,K1,SH_K\n",
  "calendar.txt":
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
    "S1,1,1,1,1,1,1,1,20261001,20261231\nS2,1,1,1,1,1,0,0,20261001,20261231\nS3,0,0,0,0,0,1,1,20261001,20261231\n",
  "frequencies.txt": "trip_id,start_time,end_time,headway_secs\nB1,06:00:00,09:00:00,600\nK1,06:00:00,09:00:00,600\n",
  "stop_times.txt":
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
    // A train from Taipei to Kaohsiung: two stops inside, so kept whole.
    "T1,08:00:00,08:00:00,TRA_1000,1\nT1,08:10:00,08:10:00,TRA_1020,2\nT1,09:30:00,09:30:00,TRA_3300,3\nT1,11:00:00,11:00:00,KHH1,4\n" +
    "B1,06:00:00,06:00:00,TPE1,1\nB1,06:10:00,06:10:00,TPE2,2\n" +
    "K1,06:00:00,06:00:00,KHH1,1\nK1,06:10:00,06:10:00,KHH2,2\n",
  "shapes.txt":
    "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nSH_T,25.04,121.51,1\nSH_B,25.04,121.51,1\nSH_K,22.6,120.3,1\nSH_K,22.7,120.3,2\n",
};

describe("cleanFeed with a region", () => {
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
  const { data, repairs } = cleanFeed(zip, { region: box });
  const out = unzipSync(data);
  const text = (name: string) => new TextDecoder().decode(out[name]);
  const ids = (name: string) =>
    text(name)
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => l.split(",")[0]);

  it("keeps trips with two stops inside whole, and drops trips outside", () => {
    expect(ids("trips.txt").length).toBe(2);
    expect(text("trips.txt")).toContain("T1");
    expect(text("trips.txt")).not.toContain("K1");
    // The train keeps its stops outside the region, so its times are intact.
    expect(text("stop_times.txt")).toContain("T1,11:00:00,11:00:00,KHH1,4");
    expect(text("stop_times.txt")).not.toContain("K1,");
  });

  it("keeps only what kept trips use", () => {
    expect(ids("stops.txt").sort()).toEqual([
      "BQ",
      "BQ_E",
      "BQ_N",
      "BQ_P",
      "E1",
      "KHH1",
      "ST",
      "TPE1",
      "TPE2",
      "TRA_1000",
      "TRA_1020",
      "TRA_3300",
    ]);
    // Stations in the box keep their pathways even when no trip uses their platforms.
    expect(ids("pathways.txt")).toEqual(["P1", "P2"]);
    expect(ids("routes.txt").sort()).toEqual(["TPE1_0", "TRA_1_0_1"]);
    expect(ids("agency.txt").sort()).toEqual(["TPE", "TRA"]);
    expect(ids("calendar.txt").sort()).toEqual(["S1", "S2"]);
    expect(ids("frequencies.txt")).toEqual(["B1"]);
    expect(ids("shapes.txt").sort()).toEqual(["SH_B", "SH_T"]);
  });

  it("reports what it removed", () => {
    expect(repairs.filter((r) => r.what.includes("region")).map((r) => `${r.file}:${r.rows}`)).toEqual([
      "stop_times.txt:2",
      "stops.txt:1",
      "trips.txt:1",
      "routes.txt:1",
      "agency.txt:1",
      "calendar.txt:1",
      "frequencies.txt:1",
      "shapes.txt:2",
    ]);
  });
});

describe("parseBBox", () => {
  it("reads minLon,minLat,maxLon,maxLat and rejects nonsense", () => {
    expect(parseBBox(" 121.28, 24.85 ,121.8,25.3")).toEqual({
      minLon: 121.28,
      minLat: 24.85,
      maxLon: 121.8,
      maxLat: 25.3,
    });
    expect(() => parseBBox("121.8,25.3,121.28,24.85")).toThrow();
    expect(() => parseBBox("121,25")).toThrow();
  });
});
