import type { Departure, DepartureBoard, StopSummary } from "@twc/contracts";
import { localId, tdxRouteKey } from "../lib/ids";
import type { EtaQuery, EtaResult, IngestClient } from "../lib/ingest-client";
import type { OtpClient } from "../otp/client";
import { STOP_DEPARTURES_QUERY, STOPS_NEARBY_QUERY } from "../otp/queries";
import type { OtpStopDeparturesData, OtpStopsNearbyData } from "../otp/types";
import { mapMode } from "../plan/map";

export interface StopDeps {
  otp: Pick<OtpClient, "query">;
  ingest: Pick<IngestClient, "busEta">;
  now?: () => Date;
}

export async function nearbyStops(
  lat: number,
  lon: number,
  radius: number,
  deps: Pick<StopDeps, "otp">,
): Promise<StopSummary[]> {
  const data = await deps.otp.query<OtpStopsNearbyData>(STOPS_NEARBY_QUERY, { lat, lon, radius, first: 30 });
  return (data.stopsByRadius?.edges ?? [])
    .map((e) => e?.node)
    .filter((n): n is NonNullable<typeof n> => !!n?.stop)
    .map((n) => {
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      const s = n.stop!;
      return {
        id: s.gtfsId,
        name: s.name,
        ...(s.code ? { code: s.code } : {}),
        lat: s.lat,
        lon: s.lon,
        ...(n.distance !== null ? { distanceMeters: n.distance } : {}),
        modes: s.vehicleMode ? [mapMode(s.vehicleMode)] : [],
      };
    });
}

/** The ingest endpoint accepts at most this many queries per call. */
const ETA_BATCH = 50;
/** A board shows departures in the next hour, at most this many in total across routes. */
const BOARD_WINDOW_S = 3600;
const BOARD_DEPARTURES = 20;

interface BoardRow {
  dep: Departure;
  /** TDX lookup key for a bus departure without its own realtime data. */
  query?: EtaQuery;
}

/**
 * Departures for a stop: OTP timetable (with rail delays where available) plus TDX live ETAs
 * per bus route. TDX gives one ETA per route and direction = the next bus, so it is attached to
 * the first scheduled departure of that route only. ETAs come from `ingest.busEta`, the same
 * lookup trip legs use, so a departure board and a trip agree on what is live.
 */
export async function stopDepartures(stopId: string, deps: StopDeps): Promise<DepartureBoard | null> {
  const now = deps.now?.() ?? new Date();
  const data = await deps.otp.query<OtpStopDeparturesData>(STOP_DEPARTURES_QUERY, {
    id: stopId,
    startTime: Math.floor(now.getTime() / 1000),
    timeRange: BOARD_WINDOW_S,
    n: BOARD_DEPARTURES,
  });
  const stop = data.stop;
  if (!stop) return null;

  const stopUid = localId(stop.gtfsId);
  const rows: BoardRow[] = (stop.stoptimesWithoutPatterns ?? [])
    .filter(
      (st): st is NonNullable<typeof st> => !!st?.trip && st.serviceDay !== null && st.scheduledDeparture !== null,
    )
    .map((st) => {
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      const trip = st.trip!;
      const base = (st.serviceDay ?? 0) * 1000;
      const hasRt = st.realtime === true && st.realtimeDeparture !== null;
      const dep: Departure = {
        routeId: trip.route.gtfsId,
        ...(trip.route.shortName ? { routeShortName: trip.route.shortName } : {}),
        mode: mapMode(trip.route.mode),
        ...(st.headsign ? { headsign: st.headsign } : {}),
        scheduled: new Date(base + (st.scheduledDeparture ?? 0) * 1000).toISOString(),
        ...(hasRt ? { estimated: new Date(base + (st.realtimeDeparture ?? 0) * 1000).toISOString() } : {}),
        realtime: hasRt ? "live" : "scheduled",
      };
      const route = tdxRouteKey(trip.route.gtfsId);
      if (hasRt || !stopUid || !route || (dep.mode !== "BUS" && dep.mode !== "COACH")) return { dep };
      const direction = route.direction ?? (trip.directionId === null ? undefined : Number(trip.directionId));
      return { dep, query: { stopUid, ...route, ...(Number.isFinite(direction) ? { direction } : {}) } };
    })
    .sort((a, b) => Date.parse(a.dep.scheduled) - Date.parse(b.dep.scheduled));

  // One lookup per route and direction, answered on its first scheduled departure.
  const firsts = new Map<string, BoardRow>();
  for (const row of rows) {
    if (!row.query) continue;
    const key = `${row.query.subRouteUid}|${row.query.direction ?? ""}`;
    if (!firsts.has(key)) firsts.set(key, row);
  }
  const targets = [...firsts.values()];

  // Bus routes at this stop with no timetabled departure in the board's hour. OTP lists no stop
  // times for trips that run on headways (frequencies.txt: 219 routes in the TDX feed, e.g. 307莒光
  // at Taipei Main Station), and Taipei timetables miss buses TDX tracks (on 2026-10-12 at 20:05,
  // route 253's next timetabled trip was 21:18 while TDX predicted a bus in 5 minutes). A live
  // prediction within the hour is shown as the departure.
  const listed = new Set(rows.map((r) => r.dep.routeId));
  const headway = new Map<
    string,
    {
      route: { gtfsId: string; shortName: string | null; mode: string | null };
      headsign: string | null;
      query: EtaQuery;
    }
  >();
  for (const p of stop.patterns ?? []) {
    if (!p || listed.has(p.route.gtfsId) || !stopUid) continue;
    const mode = mapMode(p.route.mode);
    const route = tdxRouteKey(p.route.gtfsId);
    if ((mode !== "BUS" && mode !== "COACH") || !route) continue;
    const direction = route.direction ?? p.directionId ?? undefined;
    const key = `${route.subRouteUid}|${direction ?? ""}`;
    if (firsts.has(key) || headway.has(key)) continue;
    headway.set(key, {
      route: p.route,
      headsign: p.headsign,
      query: { stopUid, ...route, ...(direction !== undefined ? { direction } : {}) },
    });
  }
  const headwayRoutes = [...headway.values()];

  const results = await lookupEtas(
    [...targets.map((t) => t.query as EtaQuery), ...headwayRoutes.map((h) => h.query)],
    deps.ingest,
  );
  for (const [k, row] of targets.entries()) {
    const eta = results[k];
    if (!eta || eta.etaSeconds === null) continue;
    row.dep.realtime = "live";
    row.dep.live = { etaSeconds: eta.etaSeconds, asOf: eta.asOf, source: "tdx-eta", isLastBus: eta.isLastBus };
  }
  const extra: Departure[] = [];
  for (const [k, h] of headwayRoutes.entries()) {
    const eta = results[targets.length + k];
    if (!eta || eta.etaSeconds === null) continue;
    const dueMs = Date.parse(eta.asOf) + eta.etaSeconds * 1000;
    // Same window as the timetable: from a minute ago (bus at the stop) to an hour ahead.
    if (!Number.isFinite(dueMs) || dueMs < now.getTime() - 60_000 || dueMs > now.getTime() + BOARD_WINDOW_S * 1000) {
      continue;
    }
    const due = new Date(dueMs).toISOString();
    extra.push({
      routeId: h.route.gtfsId,
      ...(h.route.shortName ? { routeShortName: h.route.shortName } : {}),
      mode: mapMode(h.route.mode),
      ...(h.headsign ? { headsign: h.headsign } : {}),
      // No timetable for headway trips: the predicted time is the only time there is.
      scheduled: due,
      estimated: due,
      realtime: "live",
      live: { etaSeconds: eta.etaSeconds, asOf: eta.asOf, source: "tdx-eta", isLastBus: eta.isLastBus },
    });
  }

  const departures = [...rows.map((r) => r.dep), ...extra].sort(
    (a, b) => Date.parse(a.estimated ?? a.scheduled) - Date.parse(b.estimated ?? b.scheduled),
  );
  return {
    stop: {
      id: stop.gtfsId,
      name: stop.name,
      ...(stop.code ? { code: stop.code } : {}),
      lat: stop.lat,
      lon: stop.lon,
      modes: stop.vehicleMode ? [mapMode(stop.vehicleMode)] : [],
    },
    departures,
  };
}

/** Batched ETA lookups; live data is best-effort, so a failed batch yields no ETAs. */
async function lookupEtas(queries: EtaQuery[], ingest: Pick<IngestClient, "busEta">): Promise<(EtaResult | null)[]> {
  const batches: EtaQuery[][] = [];
  for (let i = 0; i < queries.length; i += ETA_BATCH) batches.push(queries.slice(i, i + ETA_BATCH));
  const answers = await Promise.all(
    batches.map((b) => ingest.busEta(b).catch(() => b.map((): EtaResult | null => null))),
  );
  return answers.flat();
}
