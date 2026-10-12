import { strToU8, unzipSync, zipSync } from "fflate";
import { parseCsv, parseRecord, splitRecords } from "./csv";
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

/**
 * Files whose rows OTP loads as entities with an id: a repeated id aborts the whole graph build
 * ("DuplicateEntityException"). The TDX national feed repeats some rows verbatim (two
 * levels.txt rows in October 2026), so these are de-duplicated before OTP sees them.
 */
export const OTP_KEYED_FILES: Record<string, string> = {
  "agency.txt": "agency_id",
  "stops.txt": "stop_id",
  "routes.txt": "route_id",
  "trips.txt": "trip_id",
  "calendar.txt": "service_id",
  "levels.txt": "level_id",
  "pathways.txt": "pathway_id",
};

export interface DedupeResult {
  text: string;
  /** Rows removed because their id was already seen. */
  removed: number;
  /** Removed rows whose content differed from the kept row (the first one wins). */
  conflicting: number;
}

/** Drop rows whose `keyColumn` value was already seen, keeping the first. Other rows keep their exact text. */
export function dedupeById(text: string, keyColumn: string): DedupeResult {
  const records = splitRecords(text);
  const header = records[0];
  if (header === undefined) return { text, removed: 0, conflicting: 0 };
  const col = parseRecord(header).findIndex((h) => h.trim() === keyColumn);
  if (col < 0) return { text, removed: 0, conflicting: 0 };
  const seen = new Map<string, string>();
  const kept = [header];
  let removed = 0;
  let conflicting = 0;
  for (const record of records.slice(1)) {
    const id = parseRecord(record)[col] ?? "";
    const first = seen.get(id);
    if (first === undefined) {
      seen.set(id, record);
      kept.push(record);
    } else {
      removed++;
      if (first !== record) conflicting++;
    }
  }
  if (removed === 0) return { text, removed, conflicting };
  return { text: `${kept.join("\n")}\n`, removed, conflicting };
}

export interface CleanFeedResult {
  data: Uint8Array;
  dropped: string[];
  /** Per keyed file, how many duplicate-id rows were removed. */
  deduped: Record<string, DedupeResult["removed"]>;
  conflicting: Record<string, DedupeResult["conflicting"]>;
}

/**
 * Make a flat GTFS feed safe for OTP: remove the `skip` files and duplicate-id rows. Returns the
 * input unchanged when there is nothing to fix. Only the keyed files are inflated to check them.
 */
export function cleanFeed(data: Uint8Array, skip: string[] = OTP_SKIPPED_FILES): CleanFeedResult {
  const dropped = listZip(data).filter((n) => skip.includes(basename(n).toLowerCase()));
  const keyedOf = (name: string) => OTP_KEYED_FILES[basename(name).toLowerCase()];
  const keyed = unzipSync(data, { filter: (f) => !f.name.endsWith("/") && keyedOf(f.name) !== undefined });
  const fixed: Record<string, Uint8Array> = {};
  const deduped: Record<string, number> = {};
  const conflicting: Record<string, number> = {};
  const decoder = new TextDecoder();
  for (const [name, bytes] of Object.entries(keyed)) {
    const result = dedupeById(decoder.decode(bytes), keyedOf(name) as string);
    if (result.removed === 0) continue;
    fixed[name] = strToU8(result.text);
    deduped[basename(name)] = result.removed;
    if (result.conflicting) conflicting[basename(name)] = result.conflicting;
  }
  if (dropped.length === 0 && Object.keys(fixed).length === 0) return { data, dropped, deduped, conflicting };
  const kept = unzipSync(data, {
    filter: (f) => !f.name.endsWith("/") && !skip.includes(basename(f.name).toLowerCase()) && !(f.name in fixed),
  });
  return { data: zipSync({ ...kept, ...fixed }, { level: 1 }), dropped, deduped, conflicting };
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
