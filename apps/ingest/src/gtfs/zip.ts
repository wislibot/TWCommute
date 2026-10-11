import { strFromU8, unzipSync } from "fflate";

/**
 * Read selected text files from a GTFS zip. Handles bundles that nest per-agency zips inside
 * one archive (the national TDX bundle's layout is confirmed in Phase 0), returning every match
 * keyed by `<inner zip>/<file>`. Large files we do not need (stop_times.txt) are never inflated.
 */
export function readGtfsFiles(zip: Uint8Array, wanted: string[], prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  const entries = unzipSync(zip, {
    filter: (f) => f.name.toLowerCase().endsWith(".zip") || wanted.includes(basename(f.name)),
  });
  for (const [name, data] of Object.entries(entries)) {
    if (name.toLowerCase().endsWith(".zip")) {
      for (const [k, v] of readGtfsFiles(data, wanted, `${prefix}${name}/`)) out.set(k, v);
    } else {
      out.set(`${prefix}${name}`, strFromU8(data));
    }
  }
  return out;
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
