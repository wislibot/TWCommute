import type { Departure, DepartureBoard, StopSummary } from "@twc/contracts";
import { localId, tdxRouteKey } from "../lib/ids";
import type { EtaResult, IngestClient } from "../lib/ingest-client";
import type { OtpClient } from "../otp/client";
import { STOP_DEPARTURES_QUERY, STOPS_NEARBY_QUERY } from "../otp/queries";
import type { OtpStopDeparturesData, OtpStopsNearbyData } from "../otp/types";
import { mapMode } from "../plan/map";

export interface StopDeps {
  otp: Pick<OtpClient, "query">;
  ingest: Pick<IngestClient, "busEtaAtStop">;
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

/**
 * Departures for a stop: OTP timetable (with rail delays where available) plus TDX live ETAs
 * per bus route. TDX gives one ETA per route = the next bus, so it is attached to the first
 * scheduled departure of that route only.
 */
export async function stopDepartures(stopId: string, deps: StopDeps): Promise<DepartureBoard | null> {
  const now = deps.now?.() ?? new Date();
  const data = await deps.otp.query<OtpStopDeparturesData>(STOP_DEPARTURES_QUERY, {
    id: stopId,
    startTime: Math.floor(now.getTime() / 1000),
    timeRange: 3600,
    n: 3,
  });
  const stop = data.stop;
  if (!stop) return null;

  const isBus = stop.vehicleMode === "BUS" || stop.vehicleMode === "COACH";
  let etas: EtaResult[] = [];
  if (isBus) {
    const stopUid = localId(stop.gtfsId);
    if (stopUid) etas = await deps.ingest.busEtaAtStop(stopUid).catch(() => []);
  }
  const usedRoutes = new Set<string>();

  const departures: Departure[] = (stop.stoptimesWithoutPatterns ?? [])
    .filter(
      (st): st is NonNullable<typeof st> => !!st?.trip && st.serviceDay !== null && st.scheduledDeparture !== null,
    )
    .map((st) => {
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      const trip = st.trip!;
      const base = (st.serviceDay ?? 0) * 1000;
      const scheduled = new Date(base + (st.scheduledDeparture ?? 0) * 1000).toISOString();
      const hasRt = st.realtime === true && st.realtimeDeparture !== null;
      const dep: Departure = {
        routeId: trip.route.gtfsId,
        ...(trip.route.shortName ? { routeShortName: trip.route.shortName } : {}),
        mode: mapMode(trip.route.mode),
        ...(st.headsign ? { headsign: st.headsign } : {}),
        scheduled,
        ...(hasRt ? { estimated: new Date(base + (st.realtimeDeparture ?? 0) * 1000).toISOString() } : {}),
        realtime: hasRt ? "live" : "scheduled",
      };
      const route = tdxRouteKey(trip.route.gtfsId);
      const routeKey = trip.route.gtfsId;
      if (!hasRt && route && !usedRoutes.has(routeKey)) {
        const direction = route.direction ?? (trip.directionId === null ? undefined : Number(trip.directionId));
        const eta = etas
          .filter(
            (e) => matchesSubRoute(e, route.subRouteUid) && (direction === undefined || e.direction === direction),
          )
          .find((e) => e.etaSeconds !== null);
        if (eta && eta.etaSeconds !== null) {
          usedRoutes.add(routeKey);
          dep.realtime = "live";
          dep.live = { etaSeconds: eta.etaSeconds, asOf: eta.asOf, source: "tdx-eta", isLastBus: eta.isLastBus };
        }
      }
      return dep;
    })
    .sort((a, b) => Date.parse(a.estimated ?? a.scheduled) - Date.parse(b.estimated ?? b.scheduled));

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

/** Same rule as the ingest ETA lookup: the GTFS route key is the sub-route, or the route itself. */
function matchesSubRoute(e: EtaResult, subRouteUid: string): boolean {
  return e.subRouteUid === subRouteUid || e.routeUid === subRouteUid;
}
