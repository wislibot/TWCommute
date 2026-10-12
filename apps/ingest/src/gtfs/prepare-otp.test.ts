import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { cleanFeed, dedupeById, feedIdFromName, renderOtpConfigs, splitBundle } from "./prepare-otp";

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

  it("removes repeated level rows that would abort the OTP build (TDX national feed)", () => {
    // Real rows from the October 2026 TDX feed: 573904/573905 appear twice in levels.txt.
    const levels =
      "\uFEFFlevel_id,level_index,level_name\n573904,-2,第一月台\n573905,-2,第二月台\n573904,-2,第一月台\n";
    const stopTimes = strToU8("trip_id,stop_id\nT1,S1\n");
    const feed = zipSync({ "levels.txt": strToU8(levels), "stop_times.txt": stopTimes });
    const { data, deduped, conflicting } = cleanFeed(feed);
    expect(deduped).toEqual({ "levels.txt": 1 });
    expect(conflicting).toEqual({});
    const files = unzipSync(data);
    expect(new TextDecoder().decode(files["levels.txt"])).toBe(
      "level_id,level_index,level_name\n573904,-2,第一月台\n573905,-2,第二月台\n",
    );
    expect(files["stop_times.txt"]).toEqual(stopTimes);
  });
});

describe("dedupeById", () => {
  it("keeps the first row and reports conflicting duplicates", () => {
    const r = dedupeById('stop_name,stop_id\r\n"A, north",1\r\nB,2\r\n"A\nsouth",1\r\n', "stop_id");
    expect(r).toEqual({ text: 'stop_name,stop_id\n"A, north",1\nB,2\n', removed: 1, conflicting: 1 });
  });

  it("leaves text untouched without duplicates or without the key column", () => {
    const text = "stop_id,stop_name\r\n1,A\r\n";
    expect(dedupeById(text, "stop_id").text).toBe(text);
    expect(dedupeById("x\n1\n1\n", "stop_id").removed).toBe(0);
  });
});
