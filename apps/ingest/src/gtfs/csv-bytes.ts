import { parseRecord } from "./csv";

/** Quote a CSV field when it needs it. */
export function quote(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
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
