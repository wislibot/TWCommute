/**
 * Phase 0 audit: measure every data assumption in docs/DATA.md against live TDX data.
 *   pnpm --filter @twc/ingest audit
 * Env: TDX_CLIENT_ID / TDX_CLIENT_SECRET, DATA_DIR (default ./data),
 *      AUDIT_CITIES (default Taipei,NewTaipei,Taichung,Kaohsiung), AUDIT_RATE_PER_MINUTE (default 5).
 * Uses data/gtfs/*.zip (downloads them first if missing) and writes data/audit/report.{json,md}.
 * Makes 5 TDX calls per city plus 5 (about 6 minutes on the free 5-requests/minute plan); GTFS
 * downloads are not counted against the quota.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BIKE_CITIES,
  BUS_CITIES,
  type BusCity,
  getBikeAvailability,
  getBikeStations,
  getBusEta,
  getBusRoutes,
  getBusStops,
  getTraLiveTrainDelay,
  getTraStations,
  TdxClient,
} from "@twc/tdx";
import { downloadGtfs } from "../gtfs/download";
import { gtfsPaths, readIfExists } from "../gtfs/files";
import { type OtpFeed, splitBundle } from "../gtfs/prepare-otp";
import { buildTraIndexFromZip, type TraIndex } from "../gtfs/tra-index";
import { analyzeBusMapping, analyzeEtaQuality } from "./bus-mapping";
import { analyzeCityPrefixes, buildGtfsIdIndex, profileFeed } from "./gtfs-profile";
import { renderMarkdown } from "./render";
import { analyzeTra } from "./tra-audit";
import type { AuditReport, TdxUsage } from "./types";
import { analyzeYouBike } from "./youbike-audit";

const DEFAULT_CITIES = "Taipei,NewTaipei,Taichung,Kaohsiung";

/** Header names that may carry rate-limit or quota information. */
const RATE_HEADER = /limit|quota|remaining|retry-after|reset/i;

function parseCities(raw: string): BusCity[] {
  const cities = raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const unknown = cities.filter((c) => !(BUS_CITIES as readonly string[]).includes(c));
  if (unknown.length) throw new Error(`Unknown AUDIT_CITIES: ${unknown.join(", ")}`);
  return cities as BusCity[];
}

async function main() {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Set TDX_CLIENT_ID and TDX_CLIENT_SECRET.");
  const dataDir = process.env.DATA_DIR ?? "./data";
  const cities = parseCities(process.env.AUDIT_CITIES ?? DEFAULT_CITIES);

  const usage: TdxUsage = { calls: 0, byStatus: {}, rateLimitHeaders: {} };
  const tdx = new TdxClient({
    clientId,
    clientSecret,
    ratePerMinute: Math.max(1, Math.floor(Number(process.env.AUDIT_RATE_PER_MINUTE ?? 5))),
    onResponse: ({ status, headers }) => {
      usage.calls++;
      usage.byStatus[status] = (usage.byStatus[status] ?? 0) + 1;
      headers.forEach((value, name) => {
        if (RATE_HEADER.test(name) && !(name in usage.rateLimitHeaders)) usage.rateLimitHeaders[name] = value;
      });
    },
  });

  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    cities,
    gtfs: [],
    cityPrefix: [],
    busMapping: [],
    eta: [],
    tra: null,
    youbike: [],
    tdx: usage,
    errors: [],
  };

  /** Run one audit step; record failures instead of aborting the whole audit. */
  async function step<T>(name: string, fn: () => Promise<T> | T): Promise<T | undefined> {
    console.log(`· ${name}`);
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push(`${name}: ${message.slice(0, 300)}`);
      console.warn(`  ✗ ${message.slice(0, 200)}`);
      return undefined;
    }
  }

  // GTFS: download if needed, then profile each feed OTP would load.
  const paths = gtfsPaths(dataDir);
  let national = await readIfExists(paths.national);
  let trtc = await readIfExists(paths.trtc);
  if (!national || !trtc) {
    await step("download GTFS", () => downloadGtfs(tdx, paths, (m) => console.log(`  ${m}`)));
    national = await readIfExists(paths.national);
    trtc = await readIfExists(paths.trtc);
  }
  const feeds: OtpFeed[] = [];
  if (national) feeds.push(...((await step("split national bundle", () => splitBundle(national.data, "tw"))) ?? []));
  if (trtc) feeds.push(...((await step("split TRTC bundle", () => splitBundle(trtc.data, "trtc"))) ?? []));
  for (const feed of feeds) {
    const profile = await step(`profile feed ${feed.feedId}`, () => profileFeed(feed));
    if (profile) report.gtfs.push(profile);
    const prefixes = await step(`city prefixes ${feed.feedId}`, () => analyzeCityPrefixes(feed));
    if (prefixes) report.cityPrefix.push(prefixes);
  }
  // Without GTFS every id would look unmatched, so the mapping check is skipped rather than reported as 0%.
  const index = feeds.length > 0 ? await step("index GTFS ids", () => buildGtfsIdIndex(feeds)) : undefined;
  if (!index) report.errors.push("bus id mapping: skipped, no GTFS feeds loaded");

  // Buses: id mapping (live-ETA overlay assumption) and ETA quality, per city.
  for (const city of [...cities, "InterCity" as const]) {
    const etas = await step(`bus ETA ${city}`, () => getBusEta(tdx, city));
    if (etas) report.eta.push(analyzeEtaQuality(city, etas, Date.now()));
    if (!index || !etas) continue;
    const stops = await step(`bus stops ${city}`, () => getBusStops(tdx, city));
    const routes = await step(`bus routes ${city}`, () => getBusRoutes(tdx, city));
    if (stops && routes) report.busMapping.push(analyzeBusMapping(city, index, stops, routes, etas));
  }

  // TRA: can live delays be mapped onto GTFS trips and stops?
  let traIndex: TraIndex | null = null;
  if (national) traIndex = (await step("build TRA index", () => buildTraIndexFromZip(national.data))) ?? null;
  const delays = await step("TRA live delays", () => getTraLiveTrainDelay(tdx));
  const stations = await step("TRA stations", () => getTraStations(tdx));
  if (delays && stations) report.tra = analyzeTra(traIndex, delays, stations, Date.now());

  // YouBike: data quality for the GBFS adapter.
  for (const city of cities.filter((c) => (BIKE_CITIES as readonly string[]).includes(c))) {
    const bikeCity = city as (typeof BIKE_CITIES)[number];
    const st = await step(`YouBike stations ${city}`, () => getBikeStations(tdx, bikeCity));
    const av = await step(`YouBike availability ${city}`, () => getBikeAvailability(tdx, bikeCity));
    if (st && av) report.youbike.push(analyzeYouBike(city, st, av, Date.now()));
  }

  const outDir = join(dataDir, "audit");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(outDir, "report.md"), renderMarkdown(report));
  console.log(`\nTDX calls: ${usage.calls} ${JSON.stringify(usage.byStatus)}; errors: ${report.errors.length}`);
  console.log(`Report: ${join(outDir, "report.md")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
