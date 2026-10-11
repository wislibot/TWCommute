import type { DockInfo, Itinerary, Leg, LegMode, LegPlace, Realtime } from "@twc/contracts";
import { parseIsoDuration } from "../lib/duration";
import type { OtpItinerary, OtpLeg, OtpLegTime, OtpPlace, OtpRentalStation } from "../otp/types";

const MODE_MAP: Record<string, LegMode> = {
  WALK: "WALK",
  BICYCLE: "BICYCLE",
  SCOOTER: "BICYCLE",
  BUS: "BUS",
  TROLLEYBUS: "BUS",
  COACH: "COACH",
  SUBWAY: "SUBWAY",
  MONORAIL: "SUBWAY",
  RAIL: "RAIL",
  TRAM: "TRAM",
  FERRY: "FERRY",
  GONDOLA: "GONDOLA",
  CABLE_CAR: "GONDOLA",
  AIRPLANE: "AIRPLANE",
};

export function mapMode(mode: string | null | undefined): LegMode {
  return (mode && MODE_MAP[mode]) || "OTHER";
}

function legTime(t: OtpLegTime) {
  return {
    scheduled: t.scheduledTime,
    ...(t.estimated ? { estimated: t.estimated.time, delaySeconds: parseIsoDuration(t.estimated.delay) } : {}),
  };
}

function dockInfo(s: OtpRentalStation | null, fallback: OtpPlace): DockInfo | undefined {
  if (!s) return undefined;
  const live = s.realtime !== false;
  return {
    stationId: s.stationId ?? s.name,
    name: s.name,
    lat: s.lat ?? fallback.lat,
    lon: s.lon ?? fallback.lon,
    bikesAvailable: live ? (s.availableVehicles?.total ?? null) : null,
    docksAvailable: live ? (s.availableSpaces?.total ?? null) : null,
  };
}

function place(p: OtpPlace, viaIndex?: number): LegPlace {
  const bikeStation = dockInfo(p.vehicleRentalStation, p);
  return {
    name: p.name ?? p.vehicleRentalStation?.name ?? "",
    lat: p.lat,
    lon: p.lon,
    ...(p.stop ? { stopId: p.stop.gtfsId, ...(p.stop.code ? { stopCode: p.stop.code } : {}) } : {}),
    ...(viaIndex !== undefined ? { viaIndex } : {}),
    ...(bikeStation ? { bikeStation } : {}),
  };
}

function realtimeOf(leg: OtpLeg): Realtime {
  if (leg.realTime) return "live";
  return leg.realtimeState === "UPDATED" || leg.realtimeState === "MODIFIED" || leg.realtimeState === "ADDED"
    ? "live"
    : "scheduled";
}

export function mapLeg(leg: OtpLeg, toViaIndex?: number, fromViaIndex?: number): Leg {
  const mode = mapMode(leg.mode);
  return {
    mode,
    from: place(leg.from, fromViaIndex),
    to: place(leg.to, toViaIndex),
    start: legTime(leg.start),
    end: legTime(leg.end),
    durationSeconds: leg.duration ?? 0,
    distanceMeters: leg.distance ?? 0,
    ...(leg.legGeometry?.points ? { geometry: leg.legGeometry.points } : {}),
    ...(leg.route
      ? {
          route: {
            id: leg.route.gtfsId,
            ...(leg.route.shortName ? { shortName: leg.route.shortName } : {}),
            ...(leg.route.longName ? { longName: leg.route.longName } : {}),
            ...(leg.route.color ? { color: `#${leg.route.color}` } : {}),
            ...(leg.route.textColor ? { textColor: `#${leg.route.textColor}` } : {}),
            ...(leg.route.agency?.name ? { agencyName: leg.route.agency.name } : {}),
          },
        }
      : {}),
    ...(leg.headsign ? { headsign: leg.headsign } : {}),
    ...(leg.trip ? { tripId: leg.trip.gtfsId } : {}),
    realtime: leg.transitLeg ? realtimeOf(leg) : "scheduled",
    rentedBike: leg.rentedBike ?? false,
  };
}

/**
 * Map an OTP itinerary. Via visits are numbered in the order the traveler reaches them:
 * the leg arriving at a visited via gets `to.viaIndex`, the leg leaving it `from.viaIndex`.
 */
export function mapItinerary(it: OtpItinerary, id: string): Itinerary {
  const legs = it.legs.filter((l): l is OtpLeg => l !== null);
  let viaCounter = -1;
  let pendingFrom: number | undefined;
  const mapped = legs.map((leg) => {
    const fromVia = pendingFrom;
    pendingFrom = undefined;
    let toVia: number | undefined;
    if (leg.to.viaLocationType === "VISIT") {
      viaCounter++;
      toVia = viaCounter;
      pendingFrom = viaCounter;
    }
    return mapLeg(leg, toVia, fromVia);
  });
  const legsOut = shiftViaDepartures(mapped);
  const first = legsOut[0];
  const last = legsOut.at(-1);
  return {
    id,
    start: it.start ?? first?.start.scheduled ?? "",
    end: it.end ?? last?.end.scheduled ?? "",
    durationSeconds: it.duration ?? 0,
    transfers: it.numberOfTransfers,
    walkDistanceMeters: it.walkDistance ?? 0,
    legs: legsOut,
  };
}

/** After a via stay, arrive at the boarding stop this long before the vehicle. */
export const VIA_BOARDING_BUFFER_MS = 2 * 60_000;

const isStreetMode = (mode: LegMode) => mode === "WALK" || mode === "BICYCLE";

/**
 * OTP honours `minimumWaitTime` at a via, but times the street legs leaving the via "as early as
 * possible", so the stay shows up as waiting at the next stop (verified against OTP 2.10 in
 * infra/smoke). Move those street legs later so the time is spent at the via, keeping a small
 * buffer before boarding.
 */
export function shiftViaDepartures(legs: Leg[]): Leg[] {
  const out = [...legs];
  for (let k = 0; k < out.length; k++) {
    if (out[k]?.from.viaIndex === undefined) continue;
    let t = k;
    while (t < out.length && isStreetMode((out[t] as Leg).mode)) t++;
    const transit = out[t];
    const lastStreet = out[t - 1];
    if (t === k || !transit || !lastStreet) continue;
    const slack = Date.parse(transit.start.scheduled) - Date.parse(lastStreet.end.scheduled) - VIA_BOARDING_BUFFER_MS;
    if (!(slack > 0)) continue;
    for (let j = k; j < t; j++) out[j] = shiftLeg(out[j] as Leg, slack);
  }
  return out;
}

function shiftLeg(leg: Leg, ms: number): Leg {
  const shift = (t: Leg["start"]) => ({
    ...t,
    scheduled: shiftIso(t.scheduled, ms),
    ...(t.estimated ? { estimated: shiftIso(t.estimated, ms) } : {}),
  });
  return { ...leg, start: shift(leg.start), end: shift(leg.end) };
}

/** Add `ms` to an ISO timestamp, keeping its UTC offset (OTP returns local +08:00 times). */
export function shiftIso(iso: string, ms: number): string {
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  const t = Date.parse(iso) + ms;
  if (!offset) return new Date(t).toISOString();
  const sign = offset[1] === "-" ? -1 : 1;
  const offsetMs = sign * (Number(offset[2]) * 60 + Number(offset[3])) * 60_000;
  return `${new Date(t + offsetMs).toISOString().slice(0, 19)}${offset[0]}`;
}
