import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Where the GTFS downloader writes and OTP's build reads. */
export function gtfsPaths(dataDir: string) {
  const dir = join(dataDir, "gtfs");
  return {
    dir,
    national: join(dir, "tdx-national.gtfs.zip"),
    trtc: join(dir, "trtc.gtfs.zip"),
    manifest: join(dir, "manifest.json"),
  };
}

export async function readIfExists(path: string): Promise<{ data: Uint8Array; mtimeMs: number } | null> {
  if (!existsSync(path)) return null;
  const [data, s] = await Promise.all([readFile(path), stat(path)]);
  return { data: new Uint8Array(data), mtimeMs: s.mtimeMs };
}
