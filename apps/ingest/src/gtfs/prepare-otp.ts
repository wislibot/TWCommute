import { unzipSync, zipSync } from "fflate";
import { parseCsv } from "./csv";
import { basename } from "./zip";

export interface OtpFeed {
  feedId: string;
  /** File name to write under the OTP base directory's gtfs/ folder. */
  fileName: string;
  data: Uint8Array;
  isTra: boolean;
}

/**
 * OTP reads flat GTFS zips only. Split a TDX bundle into one zip per inner feed (if it is a
 * zip of zips) and give each a stable, readable feed id. Feed ids end up in every OTP id
 * (`feedId:stopId`), so they must not change between builds.
 */
export function splitBundle(bundle: Uint8Array, fallbackFeedId: string): OtpFeed[] {
  const entries = unzipSync(bundle);
  const inner = Object.entries(entries).filter(([name]) => name.toLowerCase().endsWith(".zip"));
  if (inner.length === 0) {
    return [
      { feedId: fallbackFeedId, fileName: `${fallbackFeedId}.gtfs.zip`, data: bundle, isTra: isTraFeed(entries) },
    ];
  }
  const used = new Set<string>();
  return inner.map(([name, data]) => {
    const feedId = uniqueId(feedIdFromName(name), used);
    return {
      feedId,
      fileName: `${feedId}.gtfs.zip`,
      data: rezip(data),
      isTra: isTraFeed(unzipSync(data, { filter: (f) => basename(f.name) === "agency.txt" })),
    };
  });
}

/** "GTFS_TRA.zip" → "tra", "CityBus/Taipei.zip" → "taipei". */
export function feedIdFromName(name: string): string {
  const id = basename(name)
    .replace(/\.zip$/i, "")
    .replace(/^gtfs[_-]?/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return id || "feed";
}

function uniqueId(id: string, used: Set<string>): string {
  let candidate = id;
  for (let n = 2; used.has(candidate); n++) candidate = `${id}-${n}`;
  used.add(candidate);
  return candidate;
}

function isTraFeed(files: Record<string, Uint8Array>): boolean {
  const agency = Object.entries(files).find(([name]) => basename(name) === "agency.txt")?.[1];
  if (!agency) return false;
  return parseCsv(new TextDecoder().decode(agency)).some(
    (a) => /臺鐵|台鐵|Taiwan Railway/i.test(a.agency_name ?? "") || a.agency_id === "TRA",
  );
}

/** Some bundles nest files inside a folder; OTP wants GTFS files at the zip root. */
function rezip(data: Uint8Array): Uint8Array {
  const files = unzipSync(data);
  const names = Object.keys(files);
  if (names.every((n) => !n.includes("/"))) return data;
  return zipSync(
    Object.fromEntries(names.filter((n) => !n.endsWith("/")).map((n) => [basename(n), files[n] as Uint8Array])),
  );
}

export interface ConfigTemplates {
  buildConfig: Record<string, unknown>;
  routerConfigText: string;
}

/** Fill the OTP config templates with the actual feed list and service URLs. */
export function renderOtpConfigs(
  templates: ConfigTemplates,
  feeds: Pick<OtpFeed, "feedId" | "fileName" | "isTra">[],
  vars: { INGEST_URL: string },
): { buildConfig: string; routerConfig: string } {
  const buildConfig = {
    ...templates.buildConfig,
    transitFeeds: feeds.map((f) => ({ type: "gtfs", feedId: f.feedId, source: `gtfs/${f.fileName}` })),
  };
  const traFeedId = feeds.find((f) => f.isTra)?.feedId;
  const router = JSON.parse(
    templates.routerConfigText
      .replaceAll("{{INGEST_URL}}", vars.INGEST_URL)
      .replaceAll("{{TRA_FEED_ID}}", traFeedId ?? ""),
  ) as { updaters?: Array<{ type: string; feedId?: string }> };
  // Without a TRA feed there is nothing for the TRA delay updater to attach to.
  router.updaters = (router.updaters ?? []).filter((u) => !(u.type === "stop-time-updater" && !u.feedId));
  return { buildConfig: JSON.stringify(buildConfig, null, 2), routerConfig: JSON.stringify(router, null, 2) };
}
