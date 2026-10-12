import { parseCsv } from "./csv";
import { editRecords } from "./csv-bytes";
import { buildTraIndex, emptyTraIndex, readTraStopPatterns, type TraIndex } from "./tra-index";
import { basename, readGtfsBytes, readGtfsFiles } from "./zip";

/** Where a stop comes on a variant's trips: the lowest and highest stop_sequence seen. */
export interface StopPosition {
  first: number;
  last: number;
}

/**
 * Bus sub-routes stopping at each stop, as `<SubRouteUID>|<Direction>` → position, keyed by
 * StopUID, from the GTFS (TDX layout: stop_id = StopUID, route_id = `<SubRouteUID>_<Direction>`).
 * Lets a Taipei ETA row, which names only its route, be matched to the one variant that serves its
 * stop, and tells whether a variant reaches the rider's stop after the boarding stop.
 */
export type BusStopRoutes = Map<string, Map<string, StopPosition>>;

function addPosition(out: BusStopRoutes, stop: string, key: string, first: number, last: number): void {
  let variants = out.get(stop);
  if (!variants) {
    variants = new Map();
    out.set(stop, variants);
  }
  const seen = variants.get(key);
  if (!seen) variants.set(key, { first, last });
  else {
    seen.first = Math.min(seen.first, first);
    seen.last = Math.max(seen.last, last);
  }
}

export interface GtfsIndexes {
  tra: TraIndex;
  busStopRoutes: BusStopRoutes;
}

/** GTFS route types for buses: basic 3, extended 700-799 (bus) and 200-299 (coach). */
const isBusRouteType = (type: string | undefined) => {
  const n = Number(type);
  return n === 3 || (n >= 700 && n < 800) || (n >= 200 && n < 300);
};

export function buildBusStopRoutes(files: { routes?: string; trips?: string }, stopTimes: Uint8Array): BusStopRoutes {
  const busRoutes = new Map<string, string>();
  for (const r of parseCsv(files.routes ?? "")) {
    const m = /^(.+)_(\d+)$/.exec(r.route_id ?? "");
    if (m && isBusRouteType(r.route_type)) busRoutes.set(r.route_id ?? "", `${m[1]}|${m[2]}`);
  }
  const keyByTrip = new Map<string, string>();
  for (const t of parseCsv(files.trips ?? "")) {
    const key = busRoutes.get(t.route_id ?? "");
    if (key && t.trip_id) keyByTrip.set(t.trip_id, key);
  }
  const out: BusStopRoutes = new Map();
  if (keyByTrip.size === 0) return out;
  editRecords(stopTimes, ["trip_id", "stop_id", "stop_sequence"], (v) => {
    const key = keyByTrip.get(v.trip_id ?? "");
    const seq = Number(v.stop_sequence);
    if (!key || !v.stop_id || !Number.isFinite(seq)) return undefined;
    addPosition(out, v.stop_id, key, seq, seq);
    return undefined;
  });
  return out;
}

/**
 * Read a TDX GTFS zip once and build what ingest looks up at runtime: the TRA index (from the inner
 * feed with the most TRA trains, with its stop patterns) and which bus sub-routes serve each stop.
 */
export function loadGtfsIndexes(zip: Uint8Array): GtfsIndexes {
  const files = readGtfsFiles(zip, ["agency.txt", "routes.txt", "trips.txt", "stops.txt"]);
  const feeds = new Map<string, Record<string, string>>();
  for (const [path, text] of files) {
    const dir = path.slice(0, path.length - basename(path).length);
    const feed = feeds.get(dir) ?? {};
    feed[basename(path).replace(".txt", "")] = text;
    feeds.set(dir, feed);
  }
  const stopTimes = readGtfsBytes(zip, ["stop_times.txt"]);

  let tra = emptyTraIndex();
  let traDir = "";
  const busStopRoutes: BusStopRoutes = new Map();
  for (const [dir, feed] of feeds) {
    const idx = buildTraIndex(feed);
    if (idx.tripIdsByTrainNo.size > tra.tripIdsByTrainNo.size) {
      tra = idx;
      traDir = dir;
    }
    const bytes = stopTimes.get(`${dir}stop_times.txt`);
    if (!bytes) continue;
    for (const [stop, variants] of buildBusStopRoutes(feed, bytes)) {
      for (const [key, pos] of variants) addPosition(busStopRoutes, stop, key, pos.first, pos.last);
    }
  }
  const traStopTimes = stopTimes.get(`${traDir}stop_times.txt`);
  if (tra.tripIdsByTrainNo.size > 0 && traStopTimes) {
    tra.stopsByTripId = readTraStopPatterns(traStopTimes, new Set([...tra.tripIdsByTrainNo.values()].flat()));
  }
  return { tra, busStopRoutes };
}

/** The TRA index of a TDX GTFS zip. */
export function buildTraIndexFromZip(zip: Uint8Array): TraIndex {
  return loadGtfsIndexes(zip).tra;
}
