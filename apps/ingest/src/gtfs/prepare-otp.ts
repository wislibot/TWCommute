import { strToU8, unzipSync, zipSync } from "fflate";
import { parseCsv } from "./csv";
import { REPAIR_INPUT_FILES, type Repair, repairFeed, repairStopTimes } from "./repair";
import { basename } from "./zip";

export interface OtpFeed {
  feedId: string;
  /** File name to write under the OTP base directory's gtfs/ folder. */
  fileName: string;
  data: Uint8Array;
  isTra: boolean;
}

/**
 * OTP reads flat GTFS zips only. Split a TDX bundle into one zip per inner feed (if it is a
 * zip of zips) and give each a stable, readable feed id. Feed ids end up in every OTP id
 * (`feedId:stopId`), so they must not change between builds.
 */
export function splitBundle(bundle: Uint8Array, fallbackFeedId: string): OtpFeed[] {
  // Inflate only inner zips and agency.txt: a flat national bundle's stop_times.txt can be
  // gigabytes once decompressed.
  const entries = unzipSync(bundle, { filter: (f) => isZip(f.name) || basename(f.name) === "agency.txt" });
  const inner = Object.entries(entries).filter(([name]) => isZip(name));
  if (inner.length === 0) {
    return [
      { feedId: fallbackFeedId, fileName: `${fallbackFeedId}.gtfs.zip`, data: bundle, isTra: isTraFeed(entries) },
    ];
  }
  const used = new Set<string>();
  return inner.map(([name, data]) => {
    const feedId = uniqueId(feedIdFromName(name), used);
    return {
      feedId,
      fileName: `${feedId}.gtfs.zip`,
      data: rezip(data),
      isTra: isTraFeed(unzipSync(data, { filter: (f) => basename(f.name) === "agency.txt" })),
    };
  });
}

const isZip = (name: string) => name.toLowerCase().endsWith(".zip");

/** Entry names of a zip, without inflating anything. */
export function listZip(data: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(data, {
    filter: (f) => {
      names.push(f.name);
      return false;
    },
  });
  return names;
}

/** "GTFS_TRA.zip" → "tra", "CityBus/Taipei.zip" → "taipei". */
export function feedIdFromName(name: string): string {
  const id = basename(name)
    .replace(/\.zip$/i, "")
    .replace(/^gtfs[_-]?/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return id || "feed";
}

function uniqueId(id: string, used: Set<string>): string {
  let candidate = id;
  for (let n = 2; used.has(candidate); n++) candidate = `${id}-${n}`;
  used.add(candidate);
  return candidate;
}

function isTraFeed(files: Record<string, Uint8Array>): boolean {
  const agency = Object.entries(files).find(([name]) => basename(name) === "agency.txt")?.[1];
  if (!agency) return false;
  return parseCsv(new TextDecoder().decode(agency)).some(
    (a) => /臺鐵|台鐵|Taiwan Railway/i.test(a.agency_name ?? "") || a.agency_id === "TRA",
  );
}

/** Some bundles nest files inside a folder; OTP wants GTFS files at the zip root. */
function rezip(data: Uint8Array): Uint8Array {
  if (listZip(data).every((n) => !n.includes("/"))) return data;
  const files = unzipSync(data);
  const names = Object.keys(files).filter((n) => !n.endsWith("/"));
  return zipSync(Object.fromEntries(names.map((n) => [basename(n), files[n] as Uint8Array])));
}

/**
 * GTFS fare files OTP does not need: TWCommute computes TPASS coverage itself. In the TDX national
 * feed they are ~7 GB uncompressed (fare_leg_rules.txt alone is 3.8 GB) and would exhaust OTP's heap.
 */
export const OTP_SKIPPED_FILES = [
  "fare_attributes.txt",
  "fare_rules.txt",
  "fare_products.txt",
  "fare_leg_rules.txt",
  "fare_transfer_rules.txt",
  "fare_media.txt",
  "rider_categories.txt",
  "areas.txt",
  "stop_areas.txt",
];

export interface CleanFeedResult {
  data: Uint8Array;
  dropped: string[];
  repairs: Repair[];
}

/**
 * Make a flat GTFS feed loadable by OTP: remove the `skip` files and repair data errors that
 * would abort the graph build (`repairFeed`, `repairStopTimes`). Returns the input unchanged when
 * there is nothing to fix.
 */
export function cleanFeed(data: Uint8Array, skip: string[] = OTP_SKIPPED_FILES): CleanFeedResult {
  const dropped = listZip(data).filter((n) => skip.includes(basename(n).toLowerCase()));
  const isInput = (name: string) => REPAIR_INPUT_FILES.includes(basename(name).toLowerCase());
  const small = unzipSync(data, { filter: (f) => !f.name.endsWith("/") && isInput(f.name) });
  const decoder = new TextDecoder();
  const pathOf = new Map(Object.keys(small).map((path) => [basename(path).toLowerCase(), path]));
  const { changed, removedTrips, repairs } = repairFeed(
    new Map(Object.entries(small).map(([path, bytes]) => [basename(path).toLowerCase(), decoder.decode(bytes)])),
  );
  const fixed: Record<string, Uint8Array> = {};
  for (const [file, text] of changed) fixed[pathOf.get(file) as string] = strToU8(text);
  const stopTimesPath = listZip(data).find((n) => basename(n).toLowerCase() === "stop_times.txt");
  if (stopTimesPath) {
    const raw = unzipSync(data, { filter: (f) => f.name === stopTimesPath })[stopTimesPath] as Uint8Array;
    const st = repairStopTimes(raw, removedTrips);
    if (st.data !== raw) fixed[stopTimesPath] = st.data;
    repairs.push(...st.repairs);
  }
  if (dropped.length === 0 && Object.keys(fixed).length === 0) return { data, dropped, repairs };

  const kept = unzipSync(data, {
    filter: (f) => !f.name.endsWith("/") && !skip.includes(basename(f.name).toLowerCase()) && !(f.name in fixed),
  });
  return { data: zipSync({ ...kept, ...fixed }, { level: 1 }), dropped, repairs };
}

export interface ConfigTemplates {
  buildConfig: Record<string, unknown>;
  routerConfigText: string;
}

/** Fill the OTP config templates with the actual feed list and service URLs. */
export function renderOtpConfigs(
  templates: ConfigTemplates,
  feeds: Pick<OtpFeed, "feedId" | "fileName" | "isTra">[],
  vars: { INGEST_URL: string },
): { buildConfig: string; routerConfig: string } {
  const buildConfig = {
    ...templates.buildConfig,
    transitFeeds: feeds.map((f) => ({ type: "gtfs", feedId: f.feedId, source: `gtfs/${f.fileName}` })),
  };
  const traFeedId = feeds.find((f) => f.isTra)?.feedId;
  const router = JSON.parse(
    templates.routerConfigText
      .replaceAll("{{INGEST_URL}}", vars.INGEST_URL)
      .replaceAll("{{TRA_FEED_ID}}", traFeedId ?? ""),
  ) as { updaters?: Array<{ type: string; feedId?: string }> };
  // Without a TRA feed there is nothing for the TRA delay updater to attach to.
  router.updaters = (router.updaters ?? []).filter((u) => !(u.type === "stop-time-updater" && !u.feedId));
  return { buildConfig: JSON.stringify(buildConfig, null, 2), routerConfig: JSON.stringify(router, null, 2) };
}
