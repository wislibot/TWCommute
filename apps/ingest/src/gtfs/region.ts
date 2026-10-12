import { parseRecord } from "./csv";
import { editRecords } from "./csv-bytes";
import { CsvTable, type Repair } from "./repair";

/** A lon/lat box: `minLon,minLat,maxLon,maxLat`, the order osmium's `-b` takes. */
export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Greater Taipei: Taipei, New Taipei, Keelung and Tamsui. */
export const GREATER_TAIPEI = "121.28,24.85,121.80,25.30";

/** Hsinchu City, Zhubei (with HSR Hsinchu), Baoshan and the Science Park, Zhudong and Zhunan. */
export const HSINCHU = "120.85,24.67,121.11,24.885";

export function parseBBox(text: string): BBox {
  const [minLon, minLat, maxLon, maxLat] = text.split(",").map((v) => Number(v.trim()));
  const box = { minLon, minLat, maxLon, maxLat } as BBox;
  if (
    [minLon, minLat, maxLon, maxLat].some((v) => v === undefined || !Number.isFinite(v)) ||
    box.minLon >= box.maxLon ||
    box.minLat >= box.maxLat
  ) {
    throw new Error(`Invalid bounding box "${text}": expected minLon,minLat,maxLon,maxLat`);
  }
  return box;
}

const inside = (box: BBox, lat: number, lon: number) =>
  lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon;

/** GTFS route types that run on rails: tram, metro, rail, monorail and the extended rail ranges. */
function isRailRouteType(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  // Number("") is 0 (tram): a missing type is not rail.
  if (!/^\d+$/.test(t)) return false;
  const n = Number(t);
  return [0, 1, 2, 12].includes(n) || (n >= 100 && n <= 199) || (n >= 400 && n <= 499) || (n >= 900 && n <= 999);
}

export interface RegionResult {
  /** New text of each changed small file (by base name). */
  changed: Map<string, string>;
  stopTimes: Uint8Array;
  shapes: Uint8Array | undefined;
  repairs: Repair[];
  /** Distinct trips kept; 0 when nothing in the feed serves the region. */
  tripsKept: number;
}

/**
 * Keep the part of a GTFS feed that serves `box`, so a smaller machine can build and serve it
 * (all of Taiwan needs ~12 GB; docs/DATA.md). A trip is kept whole when at least two of its stops
 * are inside, or one for a rail trip: a single HSR or TRA station in the region (HSR Hsinchu) still
 * needs its trains, for its departure boards and for trips to and from it. A TRA train or intercity
 * bus through the region keeps its outside stops and times, so nothing is cut mid-trip. Then only
 * what kept trips use is kept: their stops (with parent stations and those stations' entrances and
 * nodes), routes, agencies, services, frequencies and shapes. Other references (pathways,
 * transfers, levels) are cleaned by `repairFeed` afterwards.
 */
export function trimToRegion(
  files: Map<string, string>,
  stopTimes: Uint8Array,
  shapes: Uint8Array | undefined,
  box: BBox,
): RegionResult {
  const repairs: Repair[] = [];
  const changed = new Map<string, string>();
  const tables = new Map([...files].map(([name, text]) => [name, new CsvTable(text)]));
  const stops = tables.get("stops.txt");
  const trips = tables.get("trips.txt");
  if (!stops || !trips) return { changed, stopTimes, shapes, repairs, tripsKept: trips?.values("trip_id").size ?? 0 };

  const sId = stops.col("stop_id");
  const sLat = stops.col("stop_lat");
  const sLon = stops.col("stop_lon");
  const sParent = stops.col("parent_station");
  const insideStops = new Set<string>();
  for (const r of stops.records) {
    const f = parseRecord(r);
    if (inside(box, Number(f[sLat]), Number(f[sLon])) && f[sId]) insideStops.add(f[sId] as string);
  }

  // Trips with two or more stops inside the box, or one for rail trips.
  const insideCount = new Map<string, number>();
  editRecords(stopTimes, ["trip_id", "stop_id"], (v) => {
    if (insideStops.has(v.stop_id ?? "")) insideCount.set(v.trip_id ?? "", (insideCount.get(v.trip_id ?? "") ?? 0) + 1);
    return undefined;
  });
  const routeTable = tables.get("routes.txt");
  const rId = routeTable?.col("route_id") ?? -1;
  const rType = routeTable?.col("route_type") ?? -1;
  const railRoutes = new Set<string>();
  for (const r of routeTable?.records ?? []) {
    const f = parseRecord(r);
    if (isRailRouteType(f[rType])) railRoutes.add(f[rId] ?? "");
  }
  const tId = trips.col("trip_id");
  const tRoute = trips.col("route_id");
  const railTrips = new Set<string>();
  for (const r of trips.records) {
    const f = parseRecord(r);
    if (railRoutes.has(f[tRoute] ?? "")) railTrips.add(f[tId] ?? "");
  }
  const keptTrips = new Set([...insideCount].filter(([t, n]) => n >= 2 || railTrips.has(t)).map(([t]) => t));

  const usedStops = new Set<string>();
  const trimmedStopTimes = editRecords(stopTimes, ["trip_id", "stop_id"], (v) => {
    if (!keptTrips.has(v.trip_id ?? "")) return "drop";
    usedStops.add(v.stop_id ?? "");
    return undefined;
  });
  if (trimmedStopTimes.dropped) {
    repairs.push({ file: "stop_times.txt", rows: trimmedStopTimes.dropped, what: "trip outside the region: removed" });
  }

  const filter = (file: string, keep: (f: string[], t: CsvTable) => boolean) => {
    const t = tables.get(file);
    if (!t) return;
    const before = t.records.length;
    t.records = t.records.filter((r) => keep(parseRecord(r), t));
    if (t.records.length < before) {
      repairs.push({ file, rows: before - t.records.length, what: "not used in the region: removed" });
      changed.set(file, t.toText());
    }
  };

  // Stops: the ones kept trips use, plus whole stations (with their entrances, nodes and platforms)
  // that serve them or lie in the box. TDX station pathways connect platforms no trip uses and nodes
  // without coordinates, so they are kept by station rather than by position.
  const sType = stops.col("location_type");
  const stations = new Set<string>();
  for (const r of stops.records) {
    const f = parseRecord(r);
    if (usedStops.has(f[sId] ?? "") && f[sParent]) stations.add(f[sParent] as string);
    if ((f[sType] ?? "").trim() === "1" && insideStops.has(f[sId] ?? "")) stations.add(f[sId] as string);
  }
  filter(
    "stops.txt",
    (f) => usedStops.has(f[sId] ?? "") || stations.has(f[sId] ?? "") || stations.has(f[sParent] ?? ""),
  );

  const tService = trips.col("service_id");
  const tShape = trips.col("shape_id");
  filter("trips.txt", (f) => keptTrips.has(f[tId] ?? ""));
  const tripIds = new Set<string>();
  const routes = new Set<string>();
  const services = new Set<string>();
  const shapeIds = new Set<string>();
  for (const r of trips.records) {
    const f = parseRecord(r);
    tripIds.add(f[tId] ?? "");
    routes.add(f[tRoute] ?? "");
    services.add(f[tService] ?? "");
    if (tShape >= 0 && f[tShape]) shapeIds.add(f[tShape] as string);
  }

  const rAgency = routeTable?.col("agency_id") ?? -1;
  filter("routes.txt", (f) => routes.has(f[rId] ?? ""));
  const agencies = new Set<string>();
  for (const r of routeTable?.records ?? []) agencies.add(parseRecord(r)[rAgency] ?? "");
  // A feed whose routes name no agency has one agency for all of them: keep it.
  if (rAgency >= 0) filter("agency.txt", (f, t) => agencies.has(f[t.col("agency_id")] ?? ""));

  filter("calendar.txt", (f, t) => services.has(f[t.col("service_id")] ?? ""));
  filter("calendar_dates.txt", (f, t) => services.has(f[t.col("service_id")] ?? ""));
  filter("frequencies.txt", (f, t) => keptTrips.has(f[t.col("trip_id")] ?? ""));

  let trimmedShapes = shapes;
  if (shapes) {
    const result = editRecords(shapes, ["shape_id"], (v) => (shapeIds.has(v.shape_id ?? "") ? undefined : "drop"));
    trimmedShapes = result.data;
    if (result.dropped)
      repairs.push({ file: "shapes.txt", rows: result.dropped, what: "not used in the region: removed" });
  }

  return { changed, stopTimes: trimmedStopTimes.data, shapes: trimmedShapes, repairs, tripsKept: tripIds.size };
}
