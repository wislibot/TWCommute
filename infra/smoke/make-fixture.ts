/**
 * Synthetic city for the end-to-end smoke test: a 2 km street grid in Taipei, one bus line
 * (A→B→C→D every 10 minutes) and two YouBike docks. Writes an OTP base directory using the
 * same config rendering as production (apps/ingest/src/gtfs/prepare-otp.ts).
 *   tsx infra/smoke/make-fixture.ts <outDir> <ingestUrl>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { renderOtpConfigs } from "../../apps/ingest/src/gtfs/prepare-otp";

const [outDir = "data/smoke/otp", ingestUrl = "http://127.0.0.1:8091"] = process.argv.slice(2);
const infra = join(import.meta.dirname, "../otp");

// Street grid: 11×11 nodes, ~200 m apart, residential streets both ways.
const LAT0 = 25.03;
const LON0 = 121.5;
const STEP = 0.002;
const N = 11;
const nodeId = (i: number, j: number) => 1 + i * N + j;
const nodes: string[] = [];
const ways: string[] = [];
for (let i = 0; i < N; i++)
  for (let j = 0; j < N; j++)
    nodes.push(
      `<node id="${nodeId(i, j)}" version="1" lat="${(LAT0 + i * STEP).toFixed(6)}" lon="${(LON0 + j * STEP).toFixed(6)}"/>`,
    );
let wayId = 1;
const way = (refs: number[]) =>
  ways.push(
    `<way id="${wayId++}" version="1">${refs.map((r) => `<nd ref="${r}"/>`).join("")}<tag k="highway" v="residential"/></way>`,
  );
for (let i = 0; i < N; i++) way(Array.from({ length: N }, (_, j) => nodeId(i, j)));
for (let j = 0; j < N; j++) way(Array.from({ length: N }, (_, i) => nodeId(i, j)));
mkdirSync(join(outDir, "osm"), { recursive: true });
const osmXml = join(outDir, "osm", "grid.osm");
writeFileSync(
  osmXml,
  `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="twc-smoke">\n${nodes.join("\n")}\n${ways.join("\n")}\n</osm>\n`,
);
execFileSync("osmium", ["cat", "--overwrite", osmXml, "-o", join(outDir, "osm", "taiwan.osm.pbf")]);

// GTFS: ids follow the TDX layout found in the Phase 0 audit: stop_id = StopUID,
// route_id = <SubRouteUID>_<Direction>.
const STOPS = [
  ["TPE10001", "A站", 25.032, 121.502],
  ["TPE10002", "B站", 25.04, 121.51],
  ["TPE10003", "C站", 25.044, 121.514],
  ["TPE10004", "D站", 25.048, 121.518],
] as const;
const OFFSETS_MIN = [0, 4, 7, 10];
const hhmmss = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
const taipeiDate = (offsetDays: number) =>
  new Date(Date.now() + 8 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
const stopTimes = ["trip_id,arrival_time,departure_time,stop_id,stop_sequence"];
const trips = ["route_id,service_id,trip_id,direction_id"];
// Runs around the clock so the live-departure check works at any time of day.
for (let start = 0; start <= 23 * 60 + 50; start += 10) {
  const trip = `TPE103070_0-${start}`;
  trips.push(`TPE103070_0,DAILY,${trip},0`);
  STOPS.forEach(([id], k) => {
    const t = hhmmss(start + (OFFSETS_MIN[k] ?? 0));
    stopTimes.push(`${trip},${t},${t},${id},${k + 1}`);
  });
}
const gtfs = {
  "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nTPE,臺北市公車,https://example.test,Asia/Taipei\n",
  "routes.txt": "route_id,agency_id,route_short_name,route_type\nTPE103070_0,TPE,307,3\n",
  "stops.txt": `stop_id,stop_name,stop_lat,stop_lon\n${STOPS.map(([id, name, lat, lon]) => `${id},${name},${lat},${lon}`).join("\n")}\n`,
  "trips.txt": `${trips.join("\n")}\n`,
  "stop_times.txt": `${stopTimes.join("\n")}\n`,
  "calendar.txt": `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nDAILY,1,1,1,1,1,1,1,${taipeiDate(-2)},${taipeiDate(30)}\n`,
};
mkdirSync(join(outDir, "gtfs"), { recursive: true });
writeFileSync(
  join(outDir, "gtfs", "tw.gtfs.zip"),
  zipSync(Object.fromEntries(Object.entries(gtfs).map(([k, v]) => [k, strToU8(v)]))),
);

const rendered = renderOtpConfigs(
  {
    buildConfig: JSON.parse(readFileSync(join(infra, "build-config.base.json"), "utf8")),
    routerConfigText: readFileSync(join(infra, "router-config.base.json"), "utf8"),
  },
  [{ feedId: "tw", fileName: "tw.gtfs.zip", isTra: false }],
  { INGEST_URL: ingestUrl },
);
writeFileSync(join(outDir, "build-config.json"), rendered.buildConfig);
writeFileSync(join(outDir, "router-config.json"), rendered.routerConfig);
writeFileSync(join(outDir, "otp-config.json"), readFileSync(join(infra, "otp-config.json")));
console.log(`fixture written to ${outDir}`);
