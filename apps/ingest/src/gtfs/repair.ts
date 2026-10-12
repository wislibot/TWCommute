import { parseRecord, splitRecords } from "./csv";

/**
 * Repairs for GTFS problems that make OTP abort the whole graph build. All were found in the TDX
 * national feed (October 2026, see docs/DATA.md): repeated ids, stops on levels that levels.txt
 * lacks, trips of routes that routes.txt lacks, and pathways between stops that do not exist.
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
export const REPAIR_INPUT_FILES = [...Object.keys(KEYED_FILES), "frequencies.txt"];

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

function quote(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
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

export interface RepairResult {
  /** New text of each changed file (by base name). */
  changed: Map<string, string>;
  /** Trips removed; their stop_times rows must go too (`repairStopTimes`). */
  removedTrips: Set<string>;
  repairs: Repair[];
}

/** Repair the small GTFS files (base name → text). Files that are missing are left alone. */
export function repairFeed(files: Map<string, string>): RepairResult {
  const repairs: Repair[] = [];
  const tables = new Map<string, CsvTable>();
  const changed = new Set<string>();
  for (const [name, text] of files) tables.set(name, new CsvTable(text));
  const mark = (file: string, did: boolean) => {
    if (did) changed.add(file);
  };

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
    const ids = stops.values("stop_id");
    const before = pathways.records.length;
    dropDangling(pathways, "pathways.txt", ["from_stop_id", "to_stop_id"], ids, repairs);
    mark("pathways.txt", pathways.records.length !== before);
  }

  let removedTrips = new Set<string>();
  const trips = tables.get("trips.txt");
  const routes = tables.get("routes.txt");
  if (trips && routes) {
    removedTrips = dropDangling(trips, "trips.txt", ["route_id"], routes.values("route_id"), repairs, "trip_id");
    mark("trips.txt", removedTrips.size > 0);
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

  return {
    changed: new Map([...changed].map((f) => [f, (tables.get(f) as CsvTable).toText()])),
    removedTrips,
    repairs,
  };
}

const NL = 0x0a;
const CR = 0x0d;
const QUOTE = 0x22;
const COMMA = 0x2c;

/** What to do with one record: keep it, drop it, or replace some of its fields (by column name). */
export type RecordEdit = undefined | "drop" | Record<string, string>;

/**
 * Edit the records of a large CSV file (stop_times.txt is ~370 MB) without decoding it as one
 * string. `decide` sees the values of `columns` for each record. Quoted fields (with commas or
 * newlines) are handled; edited records are re-quoted, others keep their bytes. Returns the input
 * itself when nothing changes.
 */
export function editRecords(
  bytes: Uint8Array,
  columns: string[],
  decide: (values: Record<string, string>) => RecordEdit,
): { data: Uint8Array; dropped: number; edited: number } {
  const decoder = new TextDecoder();
  const recordEnd = (start: number): number => {
    let inQuotes = false;
    for (let i = start; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === QUOTE) inQuotes = !inQuotes;
      else if (b === NL && !inQuotes) return i;
    }
    return bytes.length;
  };
  const headerEnd = recordEnd(0);
  const header = parseRecord(decoder.decode(bytes.subarray(0, headerEnd)).replace(/\r$/, "")).map((h) => h.trim());
  const wanted = columns.map((c) => [c, header.indexOf(c)] as const).filter(([, i]) => i >= 0);
  const unchanged = { data: bytes, dropped: 0, edited: 0 };
  if (wanted.length === 0) return unchanged;
  const lastCol = Math.max(...wanted.map(([, i]) => i));

  // Field values of one record; ASCII-only unquoted records (nearly all) skip the decoder.
  const valuesOf = (start: number, end: number): string[] => {
    let plain = true;
    for (let i = start; i < end && plain; i++) {
      const b = bytes[i] as number;
      if (b === QUOTE || b >= 0x80) plain = false;
    }
    if (!plain) return parseRecord(decoder.decode(bytes.subarray(start, end)));
    const out: string[] = [];
    let from = start;
    for (let i = start; i <= end && out.length <= lastCol; i++) {
      if (i === end || bytes[i] === COMMA) {
        out.push(String.fromCharCode(...bytes.subarray(from, i)));
        from = i + 1;
      }
    }
    return out;
  };

  // Changes as [start, end, replacement]: an empty replacement drops the record.
  const changes: Array<[number, number, Uint8Array]> = [];
  let dropped = 0;
  let edited = 0;
  const encoder = new TextEncoder();
  for (let start = headerEnd + 1; start < bytes.length; ) {
    const nl = recordEnd(start);
    const end = nl > start && bytes[nl - 1] === CR ? nl - 1 : nl;
    if (end > start) {
      const fields = valuesOf(start, end);
      const edit = decide(Object.fromEntries(wanted.map(([c, i]) => [c, fields[i] ?? ""])));
      if (edit === "drop") {
        changes.push([start, Math.min(nl + 1, bytes.length), new Uint8Array(0)]);
        dropped++;
      } else if (edit) {
        const all = parseRecord(decoder.decode(bytes.subarray(start, end)));
        for (const [c, v] of Object.entries(edit)) {
          const i = header.indexOf(c);
          if (i >= 0) all[i] = v;
        }
        changes.push([start, end, encoder.encode(all.map(quote).join(","))]);
        edited++;
      }
    }
    start = nl + 1;
  }
  if (changes.length === 0) return unchanged;
  const size = changes.reduce((n, [a, b, r]) => n - (b - a) + r.length, bytes.length);
  const out = new Uint8Array(size);
  let read = 0;
  let write = 0;
  for (const [a, b, r] of changes) {
    out.set(bytes.subarray(read, a), write);
    write += a - read;
    out.set(r, write);
    write += r.length;
    read = b;
  }
  out.set(bytes.subarray(read), write);
  return { data: out, dropped, edited };
}

/** GTFS times are H:MM:SS; some TDX rows (Matsu buses) have "15:15", which OTP cannot read. */
const SHORT_TIME = /^\d{1,2}:\d{2}$/;

/**
 * stop_times.txt repairs: remove rows of trips that `repairFeed` dropped and complete HH:MM
 * times with ":00".
 */
export function repairStopTimes(bytes: Uint8Array, removedTrips: Set<string>): { data: Uint8Array; repairs: Repair[] } {
  let times = 0;
  const { data, dropped } = editRecords(bytes, ["trip_id", "arrival_time", "departure_time"], (v) => {
    if (removedTrips.has(v.trip_id ?? "")) return "drop";
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
  return { data, repairs };
}
