/**
 * Download TDX GTFS static bundles for the OTP graph build.
 *   pnpm --filter @twc/ingest fetch-gtfs
 * Writes data/gtfs/tdx-national.gtfs.zip, data/gtfs/trtc.gtfs.zip and a manifest.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { downloadGtfsStatic, downloadGtfsStaticRail, TdxClient } from "@twc/tdx";
import { unzipSync } from "fflate";
import { gtfsPaths } from "./files";

async function main() {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Set TDX_CLIENT_ID and TDX_CLIENT_SECRET (TDX member center → API keys).");
    process.exit(1);
  }
  const paths = gtfsPaths(process.env.DATA_DIR ?? "./data");
  await mkdir(paths.dir, { recursive: true });
  const tdx = new TdxClient({ clientId, clientSecret, ratePerSecond: 1 });

  const manifest: Record<string, unknown> = { downloadedAt: new Date().toISOString(), files: {} };
  const downloads: Array<[string, string, () => Promise<Uint8Array>]> = [
    ["national", paths.national, () => downloadGtfsStatic(tdx)],
    ["trtc", paths.trtc, () => downloadGtfsStaticRail(tdx, "TRTC")],
  ];
  for (const [name, path, get] of downloads) {
    process.stdout.write(`Downloading ${name}… `);
    const data = await get();
    await writeFile(path, data);
    const listing = listZip(data);
    (manifest.files as Record<string, unknown>)[name] = {
      path,
      bytes: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
      entries: listing,
    };
    console.log(`${(data.byteLength / 1e6).toFixed(1)} MB, ${listing.length} entries`);
  }
  await writeFile(paths.manifest, JSON.stringify(manifest, null, 2));
  console.log(`Manifest written to ${paths.manifest}`);
}

/** File names inside a zip without inflating them. */
function listZip(data: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(data, {
    filter: (f) => {
      names.push(f.name);
      return false;
    },
  });
  return names;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
