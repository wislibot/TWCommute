import type { TdxBusEta, TdxBusRoute, TdxBusStop } from "@twc/tdx";
import { etaServesSubRoute, SubRouteIndex } from "../bus/eta-store";
import { ageSeconds, countBy, pct, percentiles } from "./stats";
import type { BusMappingResult, EtaQualityResult, GtfsIdIndex, Pct } from "./types";

/** A scheme matching less than this share is reported as "none". */
const MIN_MATCH_PCT = 5;

/** Trimmed string form of a TDX id; "" when missing (rows can be null or lack fields). */
const idOf = (value: unknown): string => (value === undefined || value === null ? "" : String(value).trim());

/** GTFS route key in the TDX layout: `<id>_<direction>`; "" when either part is missing. */
const routeKey = (id: unknown, direction: unknown) => {
  const [i, d] = [idOf(id), idOf(direction)];
  return i && d ? `${i}_${d}` : "";
};

/** `id` is non-blank and in `set` (a blank stop_code must never match a blank StopID). */
const has = (set: Set<string>, id: string) => id !== "" && set.has(id);

function uniqueBy<T>(rows: readonly (T | null | undefined)[], key: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const k = key(row);
    if (k && !byKey.has(k)) byKey.set(k, row);
  }
  return [...byKey.values()];
}

function share<T>(rows: readonly T[], test: (row: T) => boolean): Pct {
  return pct(rows.filter(test).length, rows.length);
}

function best(candidates: Array<[string, Pct]>, noneLabel: string): string {
  const top = candidates
    .filter((c): c is [string, number] => c[1] !== null && c[1] >= MIN_MATCH_PCT)
    .sort((a, b) => b[1] - a[1])[0];
  return top ? `${top[0]} (${top[1]}%)` : noneLabel;
}

/**
 * Which identifiers link TDX bus data to the TDX-built GTFS? The live-ETA overlay assumes
 * GTFS stop_id = StopUID and route_id = RouteUID (apps/api/src/plan/live-overlay.ts).
 */
export function analyzeBusMapping(
  city: string,
  index: GtfsIdIndex,
  stops: TdxBusStop[],
  routes: TdxBusRoute[],
  etas: TdxBusEta[],
): BusMappingResult {
  const uStops = uniqueBy(stops, (s) => idOf(s.StopUID));
  const uRoutes = uniqueBy(routes, (r) => idOf(r.RouteUID));
  // A sub-route is listed once per direction it runs in; each pair is a separate GTFS route.
  const subRoutes = uniqueBy(
    uRoutes.flatMap((r) => (Array.isArray(r.SubRoutes) ? r.SubRoutes : [])),
    (s) => (idOf(s.SubRouteUID) ? `${idOf(s.SubRouteUID)}|${idOf(s.Direction)}` : ""),
  );
  const uEtas = uniqueBy(etas, (e) =>
    [idOf(e.StopUID), idOf(e.RouteUID), idOf(e.SubRouteUID), idOf(e.Direction)].join("|"),
  ).filter((e) => idOf(e.StopUID) !== "");

  const stopUidInGtfs = share(uStops, (s) => has(index.stopIds, idOf(s.StopUID)));
  const stopIdInGtfs = share(uStops, (s) => has(index.stopIds, idOf(s.StopID)));
  const stopInStopCode = share(
    uStops,
    (s) => has(index.stopCodes, idOf(s.StopUID)) || has(index.stopCodes, idOf(s.StopID)),
  );
  const routeUidInGtfs = share(uRoutes, (r) => has(index.routeIds, idOf(r.RouteUID)));
  const subRouteUidInGtfs = share(subRoutes, (s) => has(index.routeIds, idOf(s.SubRouteUID)));
  const subRouteDirInGtfs = share(subRoutes, (s) => has(index.routeIds, routeKey(s.SubRouteUID, s.Direction)));
  const routeList = new SubRouteIndex(uRoutes);
  const variantsOf = (route: string, direction: number) => routeList.variants(route, direction);
  // Production rule: tdxRouteKey (apps/api/src/lib/ids.ts) + etaServesSubRoute (BusEtaStore.find).
  const joinable = (e: TdxBusEta) => {
    if (!has(index.stopIds, idOf(e.StopUID))) return false;
    const row = { routeUid: idOf(e.RouteUID), subRouteUid: idOf(e.SubRouteUID) || undefined, direction: e.Direction };
    const keys = row.subRouteUid ? [row.subRouteUid] : [row.routeUid, ...variantsOf(row.routeUid, e.Direction)];
    return keys.some(
      (k) =>
        (has(index.routeIds, routeKey(k, e.Direction)) || has(index.routeIds, k)) &&
        etaServesSubRoute(row, k, variantsOf),
    );
  };

  return {
    city,
    tdxStops: uStops.length,
    stopUidInGtfs,
    stopIdInGtfs,
    stopInStopCode,
    tdxRoutes: uRoutes.length,
    routeUidInGtfs,
    subRouteUidInGtfs,
    subRouteDirInGtfs,
    etaWithSubRoute: share(uEtas, (e) => idOf(e.SubRouteUID) !== ""),
    etaRows: uEtas.length,
    etaJoinable: share(uEtas, joinable),
    bestHypothesis: `${best(
      [
        ["StopUID=stop_id", stopUidInGtfs],
        ["StopID=stop_id", stopIdInGtfs],
        ["stop_code", stopInStopCode],
      ],
      "stops: none (<5%)",
    )}, ${best(
      [
        ["RouteUID=route_id", routeUidInGtfs],
        ["SubRouteUID=route_id", subRouteUidInGtfs],
        ["SubRouteUID_Direction=route_id", subRouteDirInGtfs],
      ],
      "routes: none (<5%)",
    )}`,
    samples: {
      tdxStopUids: uStops.slice(0, 5).map((s) => idOf(s.StopUID)),
      tdxRouteUids: uRoutes.slice(0, 5).map((r) => idOf(r.RouteUID)),
      unmatchedEtaKeys: uEtas
        .filter((e) => !joinable(e))
        .slice(0, 10)
        .map((e) => `${idOf(e.StopUID)}|${idOf(e.RouteUID)}`),
    },
  };
}

/** How complete and fresh are the live bus ETAs for a city? */
export function analyzeEtaQuality(city: string, etas: TdxBusEta[], nowMs: number): EtaQualityResult {
  const rows = etas.filter((e): e is TdxBusEta => !!e && typeof e === "object");
  const lags = rows
    .map((e) => ageSeconds(e.SrcUpdateTime || e.UpdateTime, nowMs))
    .filter((v): v is number => v !== null);
  return {
    city,
    rows: rows.length,
    distinctStops: new Set(rows.map((e) => idOf(e.StopUID)).filter(Boolean)).size,
    distinctRoutes: new Set(rows.map((e) => idOf(e.RouteUID)).filter(Boolean)).size,
    withEstimate: share(rows, (e) => typeof e.EstimateTime === "number" && Number.isFinite(e.EstimateTime)),
    stopStatus: countBy(rows, (e) => String(e.StopStatus ?? "missing")),
    lagSeconds: percentiles(lags),
  };
}
