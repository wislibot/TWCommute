import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { cleanFeed, feedIdFromName, renderOtpConfigs, splitBundle } from "./prepare-otp";

const traAgency = strToU8("agency_id,agency_name\nTRA,臺鐵\n");
const busAgency = strToU8("agency_id,agency_name\nTPE,臺北市公車\n");

describe("splitBundle", () => {
  it("keeps a flat GTFS zip as one feed", () => {
    const flat = zipSync({ "agency.txt": traAgency, "stops.txt": strToU8("stop_id\n1\n") });
    const feeds = splitBundle(flat, "tw");
    expect(feeds).toHaveLength(1);
    expect(feeds[0]).toMatchObject({ feedId: "tw", fileName: "tw.gtfs.zip", isTra: true });
  });

  it("splits nested feeds, flattens folders and detects TRA", () => {
    const bundle = zipSync({
      "GTFS_TRA.zip": zipSync({ "TRA/agency.txt": traAgency }),
      "CityBus/Taipei.zip": zipSync({ "agency.txt": busAgency }),
    });
    const feeds = splitBundle(bundle, "tw");
    expect(feeds.map((f) => [f.feedId, f.isTra])).toEqual([
      ["tra", true],
      ["taipei", false],
    ]);
    expect(Object.keys(unzipSync(feeds[0]?.data ?? new Uint8Array()))).toEqual(["agency.txt"]);
  });
});

describe("feedIdFromName", () => {
  it("makes stable lowercase ids", () => {
    expect(feedIdFromName("GTFS_TRA.zip")).toBe("tra");
    expect(feedIdFromName("dir/New Taipei.zip")).toBe("new-taipei");
  });
});

describe("renderOtpConfigs", () => {
  const infra = join(import.meta.dirname, "../../../../infra/otp");
  const templates = {
    buildConfig: JSON.parse(readFileSync(join(infra, "build-config.base.json"), "utf8")),
    routerConfigText: readFileSync(join(infra, "router-config.base.json"), "utf8"),
  };

  it("lists feeds and wires the TRA updater to the TRA feed", () => {
    const out = renderOtpConfigs(
      templates,
      [
        { feedId: "tra", fileName: "tra.gtfs.zip", isTra: true },
        { feedId: "trtc", fileName: "trtc.gtfs.zip", isTra: false },
      ],
      { INGEST_URL: "http://ingest:8081" },
    );
    const build = JSON.parse(out.buildConfig);
    expect(build.transitFeeds).toEqual([
      { type: "gtfs", feedId: "tra", source: "gtfs/tra.gtfs.zip" },
      { type: "gtfs", feedId: "trtc", source: "gtfs/trtc.gtfs.zip" },
    ]);
    const router = JSON.parse(out.routerConfig);
    const rt = router.updaters.find((u: { type: string }) => u.type === "stop-time-updater");
    expect(rt).toMatchObject({ feedId: "tra", url: "http://ingest:8081/rt/tra-trip-updates.pb" });
    expect(out.routerConfig).not.toContain("{{");
  });

  it("drops the TRA updater when no TRA feed exists", () => {
    const out = renderOtpConfigs(templates, [{ feedId: "trtc", fileName: "trtc.gtfs.zip", isTra: false }], {
      INGEST_URL: "http://x",
    });
    expect(JSON.parse(out.routerConfig).updaters.every((u: { type: string }) => u.type !== "stop-time-updater")).toBe(
      true,
    );
  });
});

describe("cleanFeed", () => {
  it("removes fare files OTP does not need and keeps everything else", () => {
    const feed = zipSync({
      "stops.txt": strToU8("stop_id\n1\n"),
      "fare_leg_rules.txt": strToU8("x\n"),
      "fare_products.txt": strToU8("y\n"),
    });
    const { data, dropped } = cleanFeed(feed);
    expect(dropped.sort()).toEqual(["fare_leg_rules.txt", "fare_products.txt"]);
    expect(Object.keys(unzipSync(data))).toEqual(["stops.txt"]);
  });

  it("returns the same bytes when there is nothing to fix", () => {
    const feed = zipSync({ "stops.txt": strToU8("stop_id\n1\n2\n") });
    expect(cleanFeed(feed).data).toBe(feed);
  });

  it("repairs the TDX national feed's data errors, including stop_times of removed trips", () => {
    const enc = (t: string) => strToU8(t);
    const feed = zipSync({
      "levels.txt": enc("\uFEFFlevel_id,level_index,level_name\n573904,-2,第一月台\n573904,-2,第一月台\n"),
      "stops.txt": enc("stop_id,stop_name,level_id\nS1,A,573904\nS2,B,573819\n"),
      "routes.txt": enc("route_id,route_type\nR1,3\n"),
      "trips.txt": enc("route_id,service_id,trip_id\nR1,D,T1\nSHIP_NewTaipei_HalohaR101_0,D,T2\n"),
      "stop_times.txt": enc(
        "trip_id,departure_time,stop_id,stop_sequence\r\nT1,15:15,S1,1\r\nT2,08:00:00,S1,1\r\nT2,08:05:00,S2,2\r\nT1,15:20:00,S2,2\r\n",
      ),
      "fare_leg_rules.txt": enc("x\n"),
    });
    const { data, dropped, repairs } = cleanFeed(feed);
    expect(dropped).toEqual(["fare_leg_rules.txt"]);
    expect(repairs.map((r) => `${r.file}:${r.rows}`)).toEqual([
      "levels.txt:1",
      "stops.txt:1",
      "trips.txt:1",
      "stop_times.txt:2",
      "stop_times.txt:1",
    ]);
    const files = unzipSync(data);
    const text = (name: string) => new TextDecoder().decode(files[name]);
    expect(text("stops.txt")).toBe("stop_id,stop_name,level_id\nS1,A,573904\nS2,B,\n");
    expect(text("stop_times.txt")).toBe(
      "trip_id,departure_time,stop_id,stop_sequence\r\nT1,15:15:00,S1,1\r\nT1,15:20:00,S2,2\r\n",
    );
    expect(Object.keys(files).sort()).toEqual(["levels.txt", "routes.txt", "stop_times.txt", "stops.txt", "trips.txt"]);
  });
});

describe("cleanFeed with excluded agencies", () => {
  it("removes an agency's routes, trips, stop times and the stops only it served", () => {
    const enc = (t: string) => strToU8(t);
    const feed = zipSync({
      "agency.txt": enc("agency_id,agency_name\nTRTC,臺北大眾捷運股份有限公司\nTPE,臺北市公車\n"),
      "routes.txt": enc("route_id,agency_id,route_type\nTRTC_BL_BL-1_0,TRTC,1\nTPE10307_0,TPE,3\n"),
      "trips.txt": enc("route_id,service_id,trip_id\nTRTC_BL_BL-1_0,D,M1\nTPE10307_0,D,B1\n"),
      "frequencies.txt": enc("trip_id,start_time,end_time,headway_secs\nM1,06:00:00,09:00:00,300\n"),
      "stops.txt": enc("stop_id,stop_name\nTRTC_BL01,頂埔\nTRTC_BL12,台北車站\nTPE1,shared\n"),
      "stop_times.txt": enc(
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
          "M1,06:00:00,06:00:00,TRTC_BL01,1\nM1,06:20:00,06:20:00,TRTC_BL12,2\nM1,06:25:00,06:25:00,TPE1,3\n" +
          "B1,07:00:00,07:00:00,TPE1,1\nB1,07:10:00,07:10:00,TRTC_BL12,2\n",
      ),
    });
    const { data, repairs } = cleanFeed(feed, { excludeAgencies: ["TRTC"] });
    const files = unzipSync(data);
    const text = (name: string) => new TextDecoder().decode(files[name]);
    expect(text("agency.txt")).toBe("agency_id,agency_name\nTPE,臺北市公車\n");
    expect(text("routes.txt")).toBe("route_id,agency_id,route_type\nTPE10307_0,TPE,3\n");
    expect(text("trips.txt")).toBe("route_id,service_id,trip_id\nTPE10307_0,D,B1\n");
    expect(text("frequencies.txt")).toBe("trip_id,start_time,end_time,headway_secs\n");
    // TRTC_BL12 and TPE1 are still served by bus B1; only TRTC_BL01 lost all service.
    expect(text("stops.txt")).toBe("stop_id,stop_name\nTRTC_BL12,台北車站\nTPE1,shared\n");
    expect(text("stop_times.txt")).toBe(
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nB1,07:00:00,07:00:00,TPE1,1\nB1,07:10:00,07:10:00,TRTC_BL12,2\n",
    );
    expect(repairs.map((r) => `${r.file}:${r.rows}`)).toEqual([
      "agency.txt:1",
      "routes.txt:1",
      "trips.txt:1",
      "frequencies.txt:1",
      "stop_times.txt:3",
      "stops.txt:1",
    ]);
  });
});
