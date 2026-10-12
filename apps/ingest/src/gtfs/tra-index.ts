import { parseCsv } from "./csv";
import { editRecords } from "./csv-bytes";
import { basename, readGtfsBytes, readGtfsFiles } from "./zip";

/**
 * Lookups needed to turn TDX TRA delays (train number + station id) into GTFS-RT updates
 * keyed by GTFS trip_id / stop_id.
 */
export interface TraIndex {
  tripIdsByTrainNo: Map<string, string[]>;
  stopIdByStationId: Map<string, string>;
  /**
   * Where each TRA trip stops, in order (from stop_times.txt; empty when it was not read). Trains
   * repeat their timetable daily, so trips share pattern arrays.
   */
  stopsByTripId: Map<string, readonly TraStop[]>;
}

export interface TraStop {
  stopId: string;
  stopSequence: number;
  /** Scheduled departure (or arrival) in seconds after the service day's midnight; may exceed 24 h. */
  timeSecs: number | null;
}

export function emptyTraIndex(): TraIndex {
  return { tripIdsByTrainNo: new Map(), stopIdByStationId: new Map(), stopsByTripId: new Map() };
}

/** "25:10:30" → 90630; null when blank or malformed. */
export function gtfsTimeSecs(t: string | undefined): number | null {
  const m = /^\s*(\d+):(\d{2})(?::(\d{2}))?\s*$/.exec(t ?? "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : null;
}

/**
 * Read the stop patterns of `tripIds` from stop_times.txt bytes (never decoded as one string: the
 * national file is ~370 MB). Identical patterns are stored once.
 */
export function readTraStopPatterns(stopTimes: Uint8Array, tripIds: Set<string>): Map<string, readonly TraStop[]> {
  const rows = new Map<string, TraStop[]>();
  editRecords(stopTimes, ["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"], (v) => {
    const tripId = v.trip_id ?? "";
    if (!tripIds.has(tripId) || !v.stop_id) return undefined;
    const stop = {
      stopId: v.stop_id,
      stopSequence: Number(v.stop_sequence),
      timeSecs: gtfsTimeSecs(v.departure_time) ?? gtfsTimeSecs(v.arrival_time),
    };
    const list = rows.get(tripId);
    if (list) list.push(stop);
    else rows.set(tripId, [stop]);
    return undefined;
  });
  const shared = new Map<string, readonly TraStop[]>();
  const out = new Map<string, readonly TraStop[]>();
  for (const [tripId, list] of rows) {
    list.sort((a, b) => a.stopSequence - b.stopSequence);
    const key = list.map((x) => `${x.stopId}@${x.stopSequence}@${x.timeSecs}`).join("|");
    const pattern = shared.get(key) ?? list;
    shared.set(key, pattern);
    out.set(tripId, pattern);
  }
  return out;
}

/**
 * Build the index from GTFS text. TRA trips are identified by agency/route ownership. The train
 * number is `trip_short_name` when present; the TDX feed has none and encodes it in the route
 * instead (`TRA_<trainNo>_<direction>_<type>`, verified in the Phase 0 audit). Stations: TDX stop
 * ids are `TRA_<StationID>`; only those are indexed when present, so bus stops whose ids end in
 * the same digits cannot collide. Other feeds fall back to stop_code / trailing digits.
 */
export function buildTraIndex(files: { agency?: string; routes?: string; trips?: string; stops?: string }): TraIndex {
  const index = emptyTraIndex();
  const agencies = parseCsv(files.agency ?? "");
  const traAgencyIds = new Set(
    agencies
      .filter((a) => /臺鐵|台鐵|TRA\b|Taiwan Railway/i.test(`${a.agency_name} ${a.agency_id}`))
      .map((a) => a.agency_id ?? ""),
  );
  const traRouteIds = new Set(
    parseCsv(files.routes ?? "")
      .filter((r) => traAgencyIds.has(r.agency_id ?? "") || (traAgencyIds.size === 0 && r.route_type === "2"))
      .map((r) => r.route_id ?? ""),
  );
  for (const t of parseCsv(files.trips ?? "")) {
    if (!traRouteIds.has(t.route_id ?? "")) continue;
    const trainNo = (t.trip_short_name ?? "").trim() || trainNoFromId(t.route_id) || trainNoFromId(t.trip_id);
    if (!trainNo || !t.trip_id) continue;
    const list = index.tripIdsByTrainNo.get(trainNo);
    if (list) list.push(t.trip_id);
    else index.tripIdsByTrainNo.set(trainNo, [t.trip_id]);
  }
  const stops = parseCsv(files.stops ?? "").filter((s) => s.stop_id);
  const traStops = stops.filter((s) => TRA_STOP.test(s.stop_id ?? ""));
  if (traStops.length > 0) {
    for (const s of traStops) {
      const key = TRA_STOP.exec(s.stop_id ?? "")?.[1];
      if (key && !index.stopIdByStationId.has(key)) index.stopIdByStationId.set(key, s.stop_id ?? "");
    }
    return index;
  }
  for (const s of stops) {
    const code = (s.stop_code ?? "").trim();
    const trailing = /(\d{3,5})$/.exec(s.stop_id ?? "")?.[1];
    for (const key of [code, trailing]) {
      if (key && !index.stopIdByStationId.has(key)) index.stopIdByStationId.set(key, s.stop_id ?? "");
    }
  }
  return index;
}

/** TDX TRA stop ids: `TRA_0900` → StationID `0900`. */
const TRA_STOP = /^TRA[_-](\d{3,5})$/;

/** `TRA_1004_0_1132` or `TRA_1004_0_1132_20261011_102700` → `1004`. */
function trainNoFromId(id: string | undefined): string {
  return /^TRA_([0-9A-Za-z]+)_/.exec(id ?? "")?.[1] ?? "";
}

/**
 * Build the index from a TDX GTFS zip, choosing the inner feed that contains TRA trips, and read
 * that feed's TRA stop patterns from stop_times.txt.
 */
export function buildTraIndexFromZip(zip: Uint8Array): TraIndex {
  const files = readGtfsFiles(zip, ["agency.txt", "routes.txt", "trips.txt", "stops.txt"]);
  const feeds = new Map<string, Record<string, string>>();
  for (const [path, text] of files) {
    const dir = path.slice(0, path.length - basename(path).length);
    const feed = feeds.get(dir) ?? {};
    feed[basename(path).replace(".txt", "")] = text;
    feeds.set(dir, feed);
  }
  let best = emptyTraIndex();
  let bestDir = "";
  for (const [dir, feed] of feeds) {
    const idx = buildTraIndex(feed);
    if (idx.tripIdsByTrainNo.size > best.tripIdsByTrainNo.size) {
      best = idx;
      bestDir = dir;
    }
  }
  if (best.tripIdsByTrainNo.size === 0) return best;
  const stopTimes = readGtfsBytes(zip, ["stop_times.txt"]).get(`${bestDir}stop_times.txt`);
  if (stopTimes) {
    best.stopsByTripId = readTraStopPatterns(stopTimes, new Set([...best.tripIdsByTrainNo.values()].flat()));
  }
  return best;
}
