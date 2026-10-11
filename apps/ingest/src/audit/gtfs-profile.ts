import { CITY_BY_CODE } from "@twc/fares";
import { strFromU8, unzipSync } from "fflate";
import { parseCsv } from "../gtfs/csv";
import { basename } from "../gtfs/zip";
import { countBy, pct, topN } from "./stats";
import type { CityPrefixResult, GtfsIdIndex, GtfsProfile } from "./types";

const PROFILE_FILES = [
  "agency.txt",
  "routes.txt",
  "trips.txt",
  "stops.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "frequencies.txt",
  "translations.txt",
];
const REQUIRED_FILES = ["agency.txt", "routes.txt", "trips.txt", "stops.txt", "stop_times.txt"];
const FARE_FILES = ["fare_attributes.txt", "fare_rules.txt", "fare_products.txt", "fare_leg_rules.txt"];
const SAMPLE = 5;

interface FeedFiles {
  /** All entry basenames, sorted. */
  files: string[];
  present: Set<string>;
  texts: Map<string, string>;
  stopTimesBytes: number | null;
  warnings: string[];
}

/**
 * Read selected small files from a flat GTFS zip without ever inflating the rest. stop_times.txt
 * and shapes.txt can be gigabytes; their size comes from the zip directory. Never throws.
 */
function readFeed(data: Uint8Array, wanted: string[]): FeedFiles {
  const out: FeedFiles = { files: [], present: new Set(), texts: new Map(), stopTimesBytes: null, warnings: [] };
  const names = new Set<string>();
  const taken = new Set<string>();
  let entries: Record<string, Uint8Array> = {};
  try {
    entries = unzipSync(data, {
      filter: (f) => {
        if (f.name.endsWith("/")) return false;
        const base = basename(f.name);
        const key = base.toLowerCase();
        names.add(base);
        out.present.add(key);
        if (key === "stop_times.txt") out.stopTimesBytes = (out.stopTimesBytes ?? 0) + f.originalSize;
        if (key.endsWith(".zip")) out.warnings.push(`nested zip ${f.name} (pass split feeds)`);
        if (!wanted.includes(key)) return false;
        if (taken.has(key)) {
          out.warnings.push(`duplicate ${base}; using the first`);
          return false;
        }
        if (f.compression !== 0 && f.compression !== 8) {
          out.warnings.push(`${base}: unsupported compression ${f.compression}`);
          return false;
        }
        taken.add(key);
        return true;
      },
    });
  } catch (err) {
    out.warnings.push(`unreadable zip: ${(err as Error).message}`);
  }
  for (const [name, bytes] of Object.entries(entries)) out.texts.set(basename(name).toLowerCase(), strFromU8(bytes));
  out.files = [...names].sort();
  return out;
}

const field = (row: Record<string, string>, key: string) => (row[key] ?? "").trim();

/** First row per non-blank id; warns about blank and duplicate ids. */
function distinctById(rows: Record<string, string>[], key: string, file: string, warnings: string[]) {
  const byId = new Map<string, Record<string, string>>();
  let blank = 0;
  let dup = 0;
  for (const row of rows) {
    const id = field(row, key);
    if (!id) blank++;
    else if (byId.has(id)) dup++;
    else byId.set(id, row);
  }
  if (blank) warnings.push(`${file}: ${blank} rows without ${key}`);
  if (dup) warnings.push(`${file}: ${dup} duplicate ${key}`);
  return byId;
}

const YYYYMMDD = /^\d{8}$/;

function calendarRange(calendar: Record<string, string>[], dates: Record<string, string>[], warnings: string[]) {
  let start: string | null = null;
  let end: string | null = null;
  const services = new Set<string>();
  let invalid = 0;
  const widen = (d: string, isStart: boolean, isEnd: boolean) => {
    if (!YYYYMMDD.test(d)) return void invalid++;
    if (isStart && (start === null || d < start)) start = d;
    if (isEnd && (end === null || d > end)) end = d;
  };
  for (const row of calendar) {
    if (field(row, "service_id")) services.add(field(row, "service_id"));
    widen(field(row, "start_date"), true, false);
    widen(field(row, "end_date"), false, true);
  }
  for (const row of dates) {
    if (field(row, "service_id")) services.add(field(row, "service_id"));
    // Removals (exception_type 2) add no service days.
    if (field(row, "exception_type") !== "2") widen(field(row, "date"), true, true);
  }
  if (invalid) warnings.push(`calendar: ${invalid} invalid dates`);
  if (calendar.length === 0 && dates.length === 0) warnings.push("no calendar data");
  return { start, end, serviceIds: services.size };
}

/** Profile one flat GTFS feed (what OTP will load). */
export function profileFeed(feed: { feedId: string; fileName: string; data: Uint8Array }): GtfsProfile {
  const f = readFeed(feed.data, PROFILE_FILES);
  const warnings = [...f.warnings];
  const csv = (name: string) => parseCsv(f.texts.get(name) ?? "");
  for (const required of REQUIRED_FILES) if (!f.present.has(required)) warnings.push(`missing ${required}`);

  const agencies = csv("agency.txt");
  const routes = distinctById(csv("routes.txt"), "route_id", "routes.txt", warnings);
  const trips = distinctById(csv("trips.txt"), "trip_id", "trips.txt", warnings);
  const stops = distinctById(csv("stops.txt"), "stop_id", "stops.txt", warnings);
  const frequencyRows = csv("frequencies.txt").length;
  if (frequencyRows > 0) warnings.push(`frequencies.txt has ${frequencyRows} rows (headway-based trips)`);
  const languages = new Set(
    csv("translations.txt")
      .map((r) => field(r, "language") || field(r, "lang"))
      .filter(Boolean),
  );
  const stopIds = [...stops.keys()];

  return {
    feedId: feed.feedId,
    fileName: feed.fileName,
    bytes: feed.data.byteLength,
    files: f.files,
    hasFrequencies: f.present.has("frequencies.txt"),
    hasShapes: f.present.has("shapes.txt"),
    hasTranslations: f.present.has("translations.txt"),
    hasFares: FARE_FILES.some((n) => f.present.has(n)),
    hasPathways: f.present.has("pathways.txt"),
    agencyCount: agencies.length,
    agencies: agencies.slice(0, 20).map((a) => ({ id: field(a, "agency_id"), name: field(a, "agency_name") })),
    routeCount: routes.size,
    routeTypeCounts: countBy(routes.values(), (r) => field(r, "route_type") || "unknown"),
    tripCount: trips.size,
    stopCount: stops.size,
    stationCount: [...stops.values()].filter((s) => field(s, "location_type") === "1").length,
    stopTimesBytes: f.stopTimesBytes,
    frequencyRows,
    calendar: calendarRange(csv("calendar.txt"), csv("calendar_dates.txt"), warnings),
    translationLanguages: [...languages].sort(),
    idSamples: {
      stop: stopIds.slice(0, SAMPLE),
      route: [...routes.keys()].slice(0, SAMPLE),
      trip: [...trips.keys()].slice(0, SAMPLE),
    },
    stopIdPrefixes: topN(
      countBy(stopIds, (id) => id.slice(0, 3)),
      15,
    ),
    warnings,
  };
}

/** Union of GTFS identifiers across feeds (without OTP feed prefixes). */
export function buildGtfsIdIndex(feeds: Array<{ data: Uint8Array }>): GtfsIdIndex {
  const index: GtfsIdIndex = {
    stopIds: new Set(),
    stopCodes: new Set(),
    routeIds: new Set(),
    routeShortNames: new Set(),
  };
  const add = (set: Set<string>, value: string) => value && set.add(value);
  for (const feed of feeds) {
    const f = readFeed(feed.data, ["stops.txt", "routes.txt"]);
    for (const s of parseCsv(f.texts.get("stops.txt") ?? "")) {
      add(index.stopIds, field(s, "stop_id"));
      add(index.stopCodes, field(s, "stop_code"));
    }
    for (const r of parseCsv(f.texts.get("routes.txt") ?? "")) {
      add(index.routeIds, field(r, "route_id"));
      add(index.routeShortNames, field(r, "route_short_name"));
    }
  }
  return index;
}

/** How many stop_ids start with a TDX city code (what the TPASS city lookup relies on). */
export function analyzeCityPrefixes(feed: { feedId: string; data: Uint8Array }): CityPrefixResult {
  const f = readFeed(feed.data, ["stops.txt"]);
  const ids = [
    ...new Set(
      parseCsv(f.texts.get("stops.txt") ?? "")
        .map((s) => field(s, "stop_id"))
        .filter(Boolean),
    ),
  ];
  const byCity: Record<string, number> = {};
  const unresolved: string[] = [];
  for (const id of ids) {
    const code = id.slice(0, 3).toUpperCase();
    const city = Object.hasOwn(CITY_BY_CODE, code) ? CITY_BY_CODE[code] : undefined;
    if (city) byCity[city] = (byCity[city] ?? 0) + 1;
    else unresolved.push(id);
  }
  return {
    feedId: feed.feedId,
    stops: ids.length,
    resolved: pct(ids.length - unresolved.length, ids.length),
    byCity,
    unresolvedSamples: unresolved.slice(0, 10),
  };
}
