import { parseRecord, splitRecords } from "./csv";
import { editRecords, quote } from "./csv-bytes";

/**
 * Repairs for GTFS problems that make OTP abort the whole graph build. All were found in the TDX
 * national feed (October 2026, see docs/DATA.md): repeated ids, stops on levels that levels.txt
 * lacks, trips of routes that routes.txt lacks, pathways between stops that do not exist, to a
 * station or from a stop to itself, and HH:MM times; plus one service_id per calendar, without which OTP's build stalls.
 * Each repair is the smallest change that keeps the rest of the data: clear an optional
 * reference, or drop the rows that cannot be loaded.
 */
export interface Repair {
  file: string;
  rows: number;
  what: string;
}

/**
 * Files whose rows OTP loads as entities with an id: a repeated id aborts the build
 * ("DuplicateEntityException").
 */
export const KEYED_FILES: Record<string, string> = {
  "agency.txt": "agency_id",
  "stops.txt": "stop_id",
  "routes.txt": "route_id",
  "trips.txt": "trip_id",
  "calendar.txt": "service_id",
  "levels.txt": "level_id",
  "pathways.txt": "pathway_id",
};

/** Small files the repair reads; stop_times.txt is filtered separately as bytes. */
export const REPAIR_INPUT_FILES = [...Object.keys(KEYED_FILES), "frequencies.txt", "calendar_dates.txt"];

/** A GTFS text file as raw records, so untouched rows keep their exact text. */
export class CsvTable {
  readonly header: string[];
  private readonly headerRaw: string;
  records: string[];

  constructor(text: string) {
    const records = splitRecords(text);
    this.headerRaw = records[0] ?? "";
    this.header = parseRecord(this.headerRaw).map((h) => h.trim());
    this.records = records.slice(1);
  }

  col(name: string): number {
    return this.header.indexOf(name);
  }

  /** Non-empty values of a column. */
  values(name: string): Set<string> {
    const c = this.col(name);
    const out = new Set<string>();
    if (c < 0) return out;
    for (const r of this.records) {
      const v = parseRecord(r)[c];
      if (v) out.add(v);
    }
    return out;
  }

  toText(): string {
    return `${[this.headerRaw, ...this.records].join("\n")}\n`;
  }
}

/** Drop rows whose key was already seen (the first wins). */
function dedupe(table: CsvTable, file: string, key: string, repairs: Repair[]): boolean {
  const c = table.col(key);
  if (c < 0) return false;
  const first = new Map<string, string>();
  let identical = 0;
  let differing = 0;
  table.records = table.records.filter((r) => {
    const id = parseRecord(r)[c] ?? "";
    const seen = first.get(id);
    if (seen === undefined) {
      first.set(id, r);
      return true;
    }
    if (seen === r) identical++;
    else differing++;
    return false;
  });
  if (identical) repairs.push({ file, rows: identical, what: `repeated ${key} (identical rows): removed` });
  if (differing) repairs.push({ file, rows: differing, what: `repeated ${key} (different rows): kept the first` });
  return identical + differing > 0;
}

/** Clear an optional reference whose target does not exist. */
function clearDangling(table: CsvTable, file: string, column: string, targets: Set<string>, repairs: Repair[]) {
  const c = table.col(column);
  if (c < 0) return false;
  let n = 0;
  table.records = table.records.map((r) => {
    const fields = parseRecord(r);
    const v = fields[c];
    if (!v || targets.has(v)) return r;
    n++;
    fields[c] = "";
    return fields.map(quote).join(",");
  });
  if (n) repairs.push({ file, rows: n, what: `${column} not found: cleared` });
  return n > 0;
}

/** Drop rows whose required reference does not exist; returns the dropped rows' `idColumn` values. */
function dropDangling(
  table: CsvTable,
  file: string,
  columns: string[],
  targets: Set<string>,
  repairs: Repair[],
  idColumn?: string,
): Set<string> {
  const cols = columns.map((c) => table.col(c)).filter((c) => c >= 0);
  const idCol = idColumn ? table.col(idColumn) : -1;
  const removed = new Set<string>();
  let n = 0;
  table.records = table.records.filter((r) => {
    const fields = parseRecord(r);
    if (cols.every((c) => !fields[c] || targets.has(fields[c] as string))) return true;
    n++;
    if (idCol >= 0 && fields[idCol]) removed.add(fields[idCol] as string);
    return false;
  });
  if (n) repairs.push({ file, rows: n, what: `${columns.join("/")} not found: removed` });
  return removed;
}

/** Stops with location_type 1 (stations). */
function stationIds(stops: CsvTable): Set<string> {
  const id = stops.col("stop_id");
  const type = stops.col("location_type");
  const out = new Set<string>();
  if (id < 0 || type < 0) return out;
  for (const r of stops.records) {
    const fields = parseRecord(r);
    if ((fields[type] ?? "").trim() === "1" && fields[id]) out.add(fields[id] as string);
  }
  return out;
}

export interface RepairResult {
  /** New text of each changed file (by base name). */
  changed: Map<string, string>;
  /** Trips removed; their stop_times rows must go too (`repairStopTimes`). */
  removedTrips: Set<string>;
  repairs: Repair[];
}

/** Repair the small GTFS files (base name → text). Files that are missing are left alone. */
export interface RepairOptions {
  /**
   * Agencies to leave out because another feed carries them better: the TDX national feed has a
   * copy of Taipei Metro (`TRTC`) next to Taipei Metro's own feed, and with both every metro trip
   * is planned twice. Their routes and trips are removed here, their stop times and the stops only
   * they used by `repairStopTimes` / `dropStops`.
   */
  excludeAgencies?: readonly string[];
}

export function repairFeed(files: Map<string, string>, options: RepairOptions = {}): RepairResult {
  const repairs: Repair[] = [];
  const tables = new Map<string, CsvTable>();
  const changed = new Set<string>();
  for (const [name, text] of files) tables.set(name, new CsvTable(text));
  const mark = (file: string, did: boolean) => {
    if (did) changed.add(file);
  };
  const excludedTrips = excludeAgencies(tables, options.excludeAgencies ?? [], repairs);
  for (const file of excludedTrips.changed) changed.add(file);

  for (const [file, key] of Object.entries(KEYED_FILES)) {
    const t = tables.get(file);
    if (t) mark(file, dedupe(t, file, key, repairs));
  }

  const stops = tables.get("stops.txt");
  const levels = tables.get("levels.txt");
  if (stops) {
    mark("stops.txt", clearDangling(stops, "stops.txt", "level_id", levels?.values("level_id") ?? new Set(), repairs));
    mark("stops.txt", clearDangling(stops, "stops.txt", "parent_station", stops.values("stop_id"), repairs));
  }
  const pathways = tables.get("pathways.txt");
  if (pathways && stops) {
    const before = pathways.records.length;
    dropDangling(pathways, "pathways.txt", ["from_stop_id", "to_stop_id"], stops.values("stop_id"), repairs);
    // GTFS forbids pathways to a station (location_type 1); OTP cannot map one and aborts.
    const stations = stationIds(stops);
    const ends = ["from_stop_id", "to_stop_id"].map((c) => pathways.col(c));
    const kept = pathways.records.filter((r) => {
      const fields = parseRecord(r);
      return ends.every((c) => c < 0 || !stations.has(fields[c] ?? ""));
    });
    if (kept.length < pathways.records.length) {
      repairs.push({
        file: "pathways.txt",
        rows: pathways.records.length - kept.length,
        what: "station endpoint: removed",
      });
      pathways.records = kept;
    }
    // A pathway from a stop to itself goes nowhere. For an elevator OTP gives both ends the same
    // vertex label, and the saved graph then fails to load (NullPointerException in
    // SerializedGraphObject.reconstructEdgeLists).
    const [from, to] = ends as [number, number];
    if (from >= 0 && to >= 0) {
      const before = pathways.records.length;
      pathways.records = pathways.records.filter((r) => {
        const fields = parseRecord(r);
        return fields[from] !== fields[to];
      });
      const loops = before - pathways.records.length;
      if (loops) repairs.push({ file: "pathways.txt", rows: loops, what: "from and to the same stop: removed" });
    }
    mark("pathways.txt", pathways.records.length !== before);
  }

  const removedTrips = new Set(excludedTrips.trips);
  const trips = tables.get("trips.txt");
  const routes = tables.get("routes.txt");
  if (trips && routes) {
    const dangling = dropDangling(trips, "trips.txt", ["route_id"], routes.values("route_id"), repairs, "trip_id");
    for (const t of dangling) removedTrips.add(t);
    mark("trips.txt", dangling.size > 0);
  }
  const frequencies = tables.get("frequencies.txt");
  if (frequencies && removedTrips.size > 0) {
    const c = frequencies.col("trip_id");
    const before = frequencies.records.length;
    frequencies.records = frequencies.records.filter((r) => !removedTrips.has(parseRecord(r)[c] ?? ""));
    const n = before - frequencies.records.length;
    if (n) repairs.push({ file: "frequencies.txt", rows: n, what: "trip removed: removed" });
    mark("frequencies.txt", n > 0);
  }

  for (const file of mergeIdenticalServices(tables, repairs)) changed.add(file);

  return {
    changed: new Map([...changed].map((f) => [f, (tables.get(f) as CsvTable).toText()])),
    removedTrips,
    repairs,
  };
}

/** Remove `agencies` with their routes and trips; returns the removed trip ids and changed files. */
function excludeAgencies(
  tables: Map<string, CsvTable>,
  agencies: readonly string[],
  repairs: Repair[],
): { trips: Set<string>; changed: string[] } {
  const trips = new Set<string>();
  if (agencies.length === 0) return { trips, changed: [] };
  const excluded = new Set(agencies);
  const changed: string[] = [];
  const filter = (file: string, keep: (fields: string[]) => boolean, what: string) => {
    const t = tables.get(file);
    if (!t) return;
    const before = t.records.length;
    t.records = t.records.filter((r) => keep(parseRecord(r)));
    if (t.records.length < before) {
      repairs.push({ file, rows: before - t.records.length, what });
      changed.push(file);
    }
  };
  const label = `agency ${agencies.join("/")} excluded (another feed carries it): removed`;
  const agencyCol = tables.get("agency.txt")?.col("agency_id") ?? -1;
  filter("agency.txt", (f) => agencyCol < 0 || !excluded.has(f[agencyCol] ?? ""), label);
  const routes = tables.get("routes.txt");
  const routeAgency = routes?.col("agency_id") ?? -1;
  const routeId = routes?.col("route_id") ?? -1;
  const removedRoutes = new Set<string>();
  filter(
    "routes.txt",
    (f) => {
      if (routeAgency < 0 || !excluded.has(f[routeAgency] ?? "")) return true;
      removedRoutes.add(f[routeId] ?? "");
      return false;
    },
    label,
  );
  const tripsTable = tables.get("trips.txt");
  const tripRoute = tripsTable?.col("route_id") ?? -1;
  const tripId = tripsTable?.col("trip_id") ?? -1;
  filter(
    "trips.txt",
    (f) => {
      if (tripRoute < 0 || !removedRoutes.has(f[tripRoute] ?? "")) return true;
      trips.add(f[tripId] ?? "");
      return false;
    },
    label,
  );
  return { trips, changed };
}

/**
 * Remove stops (and pathways touching them) after their last trip was removed, so a dropped
 * agency's stations do not linger in search and nearby results. Returns the new texts.
 */
export function dropStops(
  files: Map<string, string>,
  stopIds: ReadonlySet<string>,
): { changed: Map<string, string>; repairs: Repair[] } {
  const repairs: Repair[] = [];
  const changed = new Map<string, string>();
  if (stopIds.size === 0) return { changed, repairs };
  for (const [file, columns] of [
    ["stops.txt", ["stop_id"]],
    ["pathways.txt", ["from_stop_id", "to_stop_id"]],
  ] as const) {
    const text = files.get(file);
    if (text === undefined) continue;
    const t = new CsvTable(text);
    const cols = columns.map((c) => t.col(c)).filter((c) => c >= 0);
    const before = t.records.length;
    t.records = t.records.filter((r) => {
      const f = parseRecord(r);
      return cols.every((c) => !stopIds.has(f[c] ?? ""));
    });
    if (t.records.length < before) {
      repairs.push({ file, rows: before - t.records.length, what: "stop no longer served by any trip: removed" });
      changed.set(file, t.toText());
    }
  }
  return { changed, repairs };
}

/**
 * Give trips that run on the same days the same service_id. The TDX feed has a service_id per
 * trip (187,930) for only 445 distinct calendars, and OTP 2.10 copies its whole service map for
 * every service id it adds (`TripCalendars.withServiceCode`): the full-Taiwan build sat in that
 * step for over 20 minutes without finishing. Two ids are merged only when their calendar.txt
 * rows and their calendar_dates.txt exceptions are identical, so every trip keeps its dates.
 * Returns the changed files.
 */
function mergeIdenticalServices(tables: Map<string, CsvTable>, repairs: Repair[]): string[] {
  const calendar = tables.get("calendar.txt");
  const dates = tables.get("calendar_dates.txt");
  const trips = tables.get("trips.txt");
  if (!trips || (!calendar && !dates)) return [];
  const calId = calendar?.col("service_id") ?? -1;
  const datesId = dates?.col("service_id") ?? -1;
  const tripService = trips.col("service_id");
  if (tripService < 0 || (calendar && calId < 0) || (dates && datesId < 0)) return [];

  // Signature = the calendar row without its id + the sorted exception rows without their id.
  const rowWithout = (fields: string[], col: number) => fields.filter((_, i) => i !== col).join(",");
  const calendarSig = new Map<string, string>();
  for (const r of calendar?.records ?? []) {
    const f = parseRecord(r);
    calendarSig.set(f[calId] ?? "", rowWithout(f, calId));
  }
  const exceptions = new Map<string, string[]>();
  for (const r of dates?.records ?? []) {
    const f = parseRecord(r);
    const id = f[datesId] ?? "";
    const list = exceptions.get(id) ?? [];
    list.push(rowWithout(f, datesId));
    exceptions.set(id, list);
  }
  const canonical = new Map<string, string>();
  const bySignature = new Map<string, string>();
  for (const id of new Set([...calendarSig.keys(), ...exceptions.keys()])) {
    const sig = `${calendarSig.get(id) ?? "-"}|${(exceptions.get(id) ?? []).sort().join(";")}`;
    const first = bySignature.get(sig);
    if (first === undefined) bySignature.set(sig, id);
    canonical.set(id, first ?? id);
  }
  const merged = canonical.size - bySignature.size;
  if (merged === 0) return [];

  const keep = (table: CsvTable | undefined, col: number) => {
    if (table)
      table.records = table.records.filter((r) => canonical.get(parseRecord(r)[col] ?? "") === parseRecord(r)[col]);
  };
  keep(calendar, calId);
  keep(dates, datesId);
  trips.records = trips.records.map((r) => {
    const f = parseRecord(r);
    const id = f[tripService] ?? "";
    const to = canonical.get(id);
    if (to === undefined || to === id) return r;
    f[tripService] = to;
    return f.map(quote).join(",");
  });
  repairs.push({
    file: "calendar.txt",
    rows: merged,
    what: `service_id with the same days as another: merged (${bySignature.size} distinct calendars)`,
  });
  return ["trips.txt", ...(calendar ? ["calendar.txt"] : []), ...(dates ? ["calendar_dates.txt"] : [])];
}

/** GTFS times are H:MM:SS; some TDX rows (Matsu buses) have "15:15", which OTP cannot read. */
const SHORT_TIME = /^\d{1,2}:\d{2}$/;

/**
 * stop_times.txt repairs: remove rows of trips that `repairFeed` dropped and complete HH:MM
 * times with ":00".
 */
export function repairStopTimes(
  bytes: Uint8Array,
  removedTrips: Set<string>,
): { data: Uint8Array; repairs: Repair[]; orphanStops: Set<string> } {
  let times = 0;
  // Stops of removed trips, and stops still served: the difference has lost all its service.
  const removedStops = new Set<string>();
  const servedStops = new Set<string>();
  const { data, dropped } = editRecords(bytes, ["trip_id", "stop_id", "arrival_time", "departure_time"], (v) => {
    const stop = v.stop_id ?? "";
    if (removedTrips.has(v.trip_id ?? "")) {
      if (removedTrips.size > 0) removedStops.add(stop);
      return "drop";
    }
    if (removedTrips.size > 0) servedStops.add(stop);
    const fix: Record<string, string> = {};
    for (const c of ["arrival_time", "departure_time"]) {
      const t = (v[c] ?? "").trim();
      if (SHORT_TIME.test(t)) fix[c] = `${t}:00`;
    }
    if (Object.keys(fix).length === 0) return undefined;
    times++;
    return fix;
  });
  const repairs: Repair[] = [];
  if (dropped) repairs.push({ file: "stop_times.txt", rows: dropped, what: "trip removed: removed" });
  if (times) repairs.push({ file: "stop_times.txt", rows: times, what: "HH:MM time: completed to HH:MM:00" });
  const orphanStops = new Set([...removedStops].filter((s) => s && !servedStops.has(s)));
  return { data, repairs, orphanStops };
}
