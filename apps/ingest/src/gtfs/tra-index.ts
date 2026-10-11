import { parseCsv } from "./csv";
import { basename, readGtfsFiles } from "./zip";

/**
 * Lookups needed to turn TDX TRA delays (train number + station id) into GTFS-RT updates
 * keyed by GTFS trip_id / stop_id.
 */
export interface TraIndex {
  tripIdsByTrainNo: Map<string, string[]>;
  stopIdByStationId: Map<string, string>;
}

export function emptyTraIndex(): TraIndex {
  return { tripIdsByTrainNo: new Map(), stopIdByStationId: new Map() };
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

/** Build the index from a TDX GTFS zip, choosing the inner feed that contains TRA trips. */
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
  for (const feed of feeds.values()) {
    const idx = buildTraIndex(feed);
    if (idx.tripIdsByTrainNo.size > best.tripIdsByTrainNo.size) best = idx;
  }
  return best;
}
