/**
 * Prepare the OTP base directory from downloaded GTFS bundles:
 *   pnpm --filter @twc/ingest prepare-otp
 * Reads data/gtfs/*.gtfs.zip, writes data/otp/gtfs/<feed>.gtfs.zip plus build-config.json,
 * router-config.json and otp-config.json rendered from infra/otp/*.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gtfsPaths, readIfExists } from "./files";
import { cleanFeed, renderOtpConfigs, splitBundle } from "./prepare-otp";

async function main() {
  const dataDir = process.env.DATA_DIR ?? "./data";
  const infraDir = resolve(process.env.INFRA_DIR ?? "../../infra/otp");
  const otpDir = join(dataDir, "otp");
  const ingestUrl = process.env.OTP_INGEST_URL ?? "http://ingest:8081";
  const paths = gtfsPaths(dataDir);

  const feeds = [];
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

  await rm(join(otpDir, "gtfs"), { recursive: true, force: true });
  await mkdir(join(otpDir, "gtfs"), { recursive: true });
  for (const f of feeds) {
    // Taipei Metro's own feed has more trips, line names and colours than the copy in the national
    // feed; keeping both plans every metro trip twice (Phase 0, docs/DATA.md).
    const hasTrtcFeed = feeds.some((g) => g.feedId === "trtc");
    const excludeAgencies = hasTrtcFeed && f.feedId !== "trtc" ? ["TRTC"] : [];
    const { data, dropped, repairs } = cleanFeed(f.data, { excludeAgencies });
    f.data = data;
    if (dropped.length) console.log(`  ${f.feedId}: dropped ${dropped.join(", ")} (not used by OTP)`);
    for (const r of repairs) console.log(`  ${f.feedId}: ${r.file}: ${r.rows} rows with ${r.what}`);
    await writeFile(join(otpDir, "gtfs", f.fileName), f.data);
  }

  const rendered = renderOtpConfigs(
    {
      buildConfig: JSON.parse(await readFile(join(infraDir, "build-config.base.json"), "utf8")),
      routerConfigText: await readFile(join(infraDir, "router-config.base.json"), "utf8"),
    },
    feeds,
    { INGEST_URL: ingestUrl },
  );
  await writeFile(join(otpDir, "build-config.json"), rendered.buildConfig);
  await writeFile(join(otpDir, "router-config.json"), rendered.routerConfig);
  await writeFile(join(otpDir, "otp-config.json"), await readFile(join(infraDir, "otp-config.json")));

  console.log(`Prepared ${feeds.length} feeds in ${otpDir}:`);
  for (const f of feeds)
    console.log(`  ${f.feedId}${f.isTra ? " (TRA)" : ""}  ${(f.data.byteLength / 1e6).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
