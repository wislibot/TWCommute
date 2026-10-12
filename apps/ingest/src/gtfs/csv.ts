/**
 * Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF, UTF-8 BOM), enough for
 * GTFS text files. Returns one object per row keyed by header.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter((r) => !(r.length === 1 && r[0] === ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Fields of a single CSV record (no line terminator). */
export function parseRecord(record: string): string[] {
  return parseRows(record)[0] ?? [""];
}

/**
 * Split CSV text into raw records without their line terminators, honouring quoted newlines, so
 * rows can be filtered without re-serialising (and re-quoting) them. Strips a UTF-8 BOM.
 */
export function splitRecords(text: string): string[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (c === "\n" || c === "\r")) {
      out.push(body.slice(start, i));
      if (c === "\r" && body[i + 1] === "\n") i++;
      start = i + 1;
    }
  }
  if (start < body.length) out.push(body.slice(start));
  return out.filter((r) => r !== "");
}
