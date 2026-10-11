/**
 * Download TDX GTFS static bundles for the OTP graph build.
 *   pnpm --filter @twc/ingest fetch-gtfs
 * Writes data/gtfs/tdx-national.gtfs.zip, data/gtfs/trtc.gtfs.zip and a manifest.
 */
import { TdxClient } from "@twc/tdx";
import { downloadGtfs } from "./download";
import { gtfsPaths } from "./files";

async function main() {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Set TDX_CLIENT_ID and TDX_CLIENT_SECRET (TDX member center → API keys).");
    process.exit(1);
  }
  const paths = gtfsPaths(process.env.DATA_DIR ?? "./data");
  const tdx = new TdxClient({ clientId, clientSecret, ratePerSecond: 5 / 60, burst: 5 });
  await downloadGtfs(tdx, paths, console.log);
  console.log(`Manifest written to ${paths.manifest}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
