/**
 * Prepare the OTP base directory from downloaded GTFS bundles:
 *   pnpm --filter @twc/ingest prepare-otp
 * Reads data/gtfs/*.gtfs.zip, writes $OTP_DIR/gtfs/<feed>.gtfs.zip plus build-config.json,
 * router-config.json and otp-config.json rendered from infra/otp/*. OTP_DIR defaults to data/otp;
 * set it to build each region into its own folder.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gtfsPaths, readIfExists } from "./files";
import { cleanFeed, feedsToBuild, type OtpFeed, renderOtpConfigs, splitBundle } from "./prepare-otp";
import { parseBBox } from "./region";

async function main() {
  const dataDir = process.env.DATA_DIR ?? "./data";
  const infraDir = resolve(process.env.INFRA_DIR ?? "../../infra/otp");
  const otpDir = process.env.OTP_DIR ?? join(dataDir, "otp");
  const ingestUrl = process.env.OTP_INGEST_URL ?? "http://ingest:8081";
  // GTFS_BBOX=minLon,minLat,maxLon,maxLat keeps only the trips serving that area (smaller machines).
  const region = process.env.GTFS_BBOX ? parseBBox(process.env.GTFS_BBOX) : undefined;
  if (region) console.log(`Region: ${process.env.GTFS_BBOX}`);
  const paths = gtfsPaths(dataDir);

  const feeds: Array<OtpFeed & { tripsKept?: number }> = [];
  for (const [path, fallback] of [
    [paths.national, "tw"],
    [paths.trtc, "trtc"],
  ] as const) {
    const file = await readIfExists(path);
    if (!file) {
      console.warn(`skip: ${path} not found (run fetch-gtfs first)`);
      continue;
    }
    feeds.push(...splitBundle(file.data, fallback));
  }
  if (feeds.length === 0) throw new Error("No GTFS feeds found.");

  // Taipei Metro's own feed has more trips, line names and colours than the copy in the national
  // feed; keeping both plans every metro trip twice (Phase 0, docs/DATA.md). Decided on every
  // downloaded feed, before a region leaves any out.
  const hasTrtcFeed = feeds.some((g) => g.feedId === "trtc");
  for (const f of feeds) {
    const excludeAgencies = hasTrtcFeed && f.feedId !== "trtc" ? ["TRTC"] : [];
    const { data, dropped, repairs, tripsKept } = cleanFeed(f.data, { excludeAgencies, ...(region ? { region } : {}) });
    f.data = data;
    f.tripsKept = tripsKept;
    if (dropped.length) console.log(`  ${f.feedId}: dropped ${dropped.join(", ")} (not used by OTP)`);
    for (const r of repairs) console.log(`  ${f.feedId}: ${r.file}: ${r.rows} rows with ${r.what}`);
  }
  const { build, empty } = feedsToBuild(feeds);
  for (const f of empty) console.log(`  ${f.feedId}: no trips in the region, left out`);

  await rm(join(otpDir, "gtfs"), { recursive: true, force: true });
  await mkdir(join(otpDir, "gtfs"), { recursive: true });
  for (const f of build) await writeFile(join(otpDir, "gtfs", f.fileName), f.data);

  const rendered = renderOtpConfigs(
    {
      buildConfig: JSON.parse(await readFile(join(infraDir, "build-config.base.json"), "utf8")),
      routerConfigText: await readFile(join(infraDir, "router-config.base.json"), "utf8"),
    },
    build,
    { INGEST_URL: ingestUrl },
  );
  await writeFile(join(otpDir, "build-config.json"), rendered.buildConfig);
  await writeFile(join(otpDir, "router-config.json"), rendered.routerConfig);
  await writeFile(join(otpDir, "otp-config.json"), await readFile(join(infraDir, "otp-config.json")));

  console.log(`Prepared ${build.length} feeds in ${otpDir}:`);
  for (const f of build)
    console.log(`  ${f.feedId}${f.isTra ? " (TRA)" : ""}  ${(f.data.byteLength / 1e6).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
