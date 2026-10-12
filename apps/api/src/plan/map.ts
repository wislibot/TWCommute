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
export function mapItinerary(it: OtpItinerary, id: string, dwellMinutes: number[] = []): Itinerary {
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
  const legsOut = shiftViaDepartures(mapped, dwellMinutes);
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

/** When a leg is (expected) to happen: the live estimate when there is one. */
const when = (t: Leg["start"]) => Date.parse(t.estimated ?? t.scheduled);

/**
 * OTP honours `minimumWaitTime` at a via, but times the street legs leaving a via "as early as
 * possible", so the stay shows up as waiting at the next stop (verified against OTP 2.10 in
 * infra/smoke). For each chain of street legs between a via and the next vehicle, move legs later
 * so that:
 * - every via in the chain gets at least its requested dwell (when known), in order;
 * - when the vehicle is boarded at a via, that via's dwell is kept as the wait for the vehicle,
 *   and spare time stays there too;
 * - otherwise spare time goes to the last via before boarding, keeping up to a 2-minute buffer at
 *   the stop;
 * - nothing moves past the vehicle's (live) departure.
 * A chain can hold several vias, e.g. a stop via followed by a nearby coordinate via.
 */
export function shiftViaDepartures(legs: Leg[], dwellMinutes: number[] = []): Leg[] {
  const out = [...legs];
  let k = 0;
  while (k < out.length) {
    if ((out[k] as Leg).from.viaIndex === undefined || !isStreetMode((out[k] as Leg).mode)) {
      k++;
      continue;
    }
    let t = k;
    while (t < out.length && isStreetMode((out[t] as Leg).mode)) t++;
    const transit = out[t];
    if (!transit) break;
    let remaining = when(transit.start) - when((out[t - 1] as Leg).end);
    // Boarding at a via: the wait at that stop is its stay, so keep its dwell there.
    const boardingVia = transit.from.viaIndex;
    if (boardingVia !== undefined) remaining -= (dwellMinutes[boardingVia] ?? 0) * 60_000;
    // Extra wait to insert before each via departure in the chain.
    const extra = new Map<number, number>();
    const viaStarts: number[] = [];
    for (let j = k; j < t; j++) {
      const via = (out[j] as Leg).from.viaIndex;
      if (via === undefined) continue;
      viaStarts.push(j);
      const prev = out[j - 1];
      const stayed = prev ? when((out[j] as Leg).start) - when(prev.end) : 0;
      const need = Math.max(0, (dwellMinutes[via] ?? 0) * 60_000 - stayed);
      const give = Math.max(0, Math.min(need, remaining));
      extra.set(j, give);
      remaining -= give;
    }
    const last = viaStarts.at(-1);
    if (boardingVia === undefined && last !== undefined && remaining > VIA_BOARDING_BUFFER_MS) {
      extra.set(last, (extra.get(last) ?? 0) + remaining - VIA_BOARDING_BUFFER_MS);
    }
    let shift = 0;
    for (let j = k; j < t; j++) {
      shift += extra.get(j) ?? 0;
      if (shift > 0) out[j] = shiftLeg(out[j] as Leg, shift);
    }
    k = t;
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
