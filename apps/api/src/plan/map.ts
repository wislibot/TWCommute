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

function place(p: OtpPlace): LegPlace {
  const bikeStation = dockInfo(p.vehicleRentalStation, p);
  return {
    name: p.name ?? p.vehicleRentalStation?.name ?? "",
    lat: p.lat,
    lon: p.lon,
    ...(p.stop ? { stopId: p.stop.gtfsId, ...(p.stop.code ? { stopCode: p.stop.code } : {}) } : {}),
    ...(bikeStation ? { bikeStation } : {}),
  };
}

function realtimeOf(leg: OtpLeg): Realtime {
  if (leg.realTime) return "live";
  return leg.realtimeState === "UPDATED" || leg.realtimeState === "MODIFIED" || leg.realtimeState === "ADDED"
    ? "live"
    : "scheduled";
}

export function mapLeg(leg: OtpLeg): Leg {
  const mode = mapMode(leg.mode);
  return {
    mode,
    from: place(leg.from),
    to: place(leg.to),
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

/** Map an OTP itinerary. Stops on the way are marked by `joinSegments` (chain.ts). */
export function mapItinerary(it: OtpItinerary, id: string): Itinerary {
  const legs = it.legs.filter((l): l is OtpLeg => l !== null).map(mapLeg);
  const first = legs[0];
  const last = legs.at(-1);
  return {
    id,
    start: it.start ?? first?.start.scheduled ?? "",
    end: it.end ?? last?.end.scheduled ?? "",
    durationSeconds: it.duration ?? 0,
    transfers: it.numberOfTransfers,
    walkDistanceMeters: it.walkDistance ?? 0,
    legs,
  };
}
