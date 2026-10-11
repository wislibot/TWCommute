import type { TdxBikeAvailability, TdxBikeStation } from "@twc/tdx";
import { ageSeconds, countBy, pct, percentiles } from "./stats";
import type { YouBikeResult } from "./types";

/** Labels mirror bike/normalize.ts. */
const SERVICE: Record<number, string> = { 1: "youbike1", 2: "youbike2", 3: "moovo" };
const STATUS: Record<number, string> = { 1: "active", 2: "suspended", 0: "closed" };
const label = (map: Record<number, string>, v: unknown) =>
  typeof v === "number" && map[v] !== undefined ? (map[v] as string) : `unknown:${JSON.stringify(v ?? null)}`;

const timeOf = (r: { SrcUpdateTime?: string; UpdateTime?: string }) => r.SrcUpdateTime || r.UpdateTime || null;

function latestByUid<T extends { StationUID: string; SrcUpdateTime?: string; UpdateTime?: string }>(rows: T[]): T[] {
  const byUid = new Map<string, T>();
  const ms = (r: T) => {
    const t = Date.parse(timeOf(r) ?? "");
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  for (const r of rows) {
    // Keyed raw (not trimmed): the GBFS adapter joins with Map.get(StationUID).
    if (!r || typeof r.StationUID !== "string" || !r.StationUID) continue;
    const prev = byUid.get(r.StationUID);
    if (!prev || ms(r) > ms(prev)) byUid.set(r.StationUID, r);
  }
  return [...byUid.values()];
}

/** YouBike data quality, as seen by the GBFS adapter (bike/normalize.ts, bike/gbfs.ts). */
export function analyzeYouBike(
  city: string,
  stations: TdxBikeStation[],
  availability: TdxBikeAvailability[],
  nowMs: number,
): YouBikeResult {
  const st = latestByUid(stations);
  const av = latestByUid(availability);
  const avUids = new Set(av.map((a) => a.StationUID));
  const typeByUid = new Map(st.map((s) => [s.StationUID, s.ServiceType]));
  const active = av.filter((a) => a.ServiceStatus === 1);
  // Docks: the adapter decides from the station's service type; fall back to the row's own.
  const docked = active.filter(
    (a) => (typeByUid.get(a.StationUID) ?? a.ServiceType) !== 3 && Number.isFinite(a.AvailableReturnBikes),
  );
  return {
    city,
    stations: st.length,
    availabilityRows: av.length,
    joined: pct(st.filter((s) => avUids.has(s.StationUID)).length, st.length),
    serviceTypes: countBy(st, (s) => label(SERVICE, s.ServiceType)),
    statusCounts: countBy(av, (a) => label(STATUS, a.ServiceStatus)),
    withEbikeDetail: pct(
      av.filter((a) => Number.isFinite(a.AvailableRentBikesDetail?.ElectricBikes)).length,
      av.length,
    ),
    zeroBikes: pct(active.filter((a) => a.AvailableRentBikes === 0).length, active.length),
    zeroDocks: pct(docked.filter((a) => a.AvailableReturnBikes === 0).length, docked.length),
    lagSeconds: percentiles(av.map((a) => ageSeconds(timeOf(a), nowMs)).filter((v): v is number => v !== null)),
  };
}
