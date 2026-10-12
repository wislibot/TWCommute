import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { downloadGtfsStatic, downloadGtfsStaticRail, type TdxClient } from "@twc/tdx";
import type { gtfsPaths } from "./files";
import { listZip } from "./prepare-otp";

export interface DownloadedFile {
  path: string;
  bytes: number;
  sha256: string;
  entries: string[];
}

/**
 * Download the TDX GTFS bundles (national + Taipei Metro) and write a manifest next to them.
 * GTFS downloads are free and not counted against the TDX quota while the service is in Beta.
 * The manifest exists only while both bundles are complete (`SKIP_DOWNLOAD=1` in fetch-data.sh
 * relies on it): it is removed first and written last, and each bundle is renamed into place.
 */
export async function downloadGtfs(
  tdx: TdxClient,
  paths: ReturnType<typeof gtfsPaths>,
  log: (msg: string) => void = () => {},
): Promise<Record<string, DownloadedFile>> {
  await mkdir(paths.dir, { recursive: true });
  await rm(paths.manifest, { force: true });
  const files: Record<string, DownloadedFile> = {};
  const downloads: Array<[string, string, () => Promise<Uint8Array>]> = [
    ["national", paths.national, () => downloadGtfsStatic(tdx)],
    ["trtc", paths.trtc, () => downloadGtfsStaticRail(tdx, "TRTC")],
  ];
  for (const [name, path, get] of downloads) {
    const data = await get();
    await writeFile(`${path}.part`, data);
    await rename(`${path}.part`, path);
    files[name] = {
      path,
      bytes: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
      entries: listZip(data),
    };
    log(`${name}: ${(data.byteLength / 1e6).toFixed(1)} MB, ${files[name].entries.length} entries`);
  }
  await writeFile(paths.manifest, JSON.stringify({ downloadedAt: new Date().toISOString(), files }, null, 2));
  return files;
}
