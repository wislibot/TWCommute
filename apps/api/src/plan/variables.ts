import type { PlaceInput, PlanRequest } from "@twc/contracts";

function location(place: PlaceInput) {
  return {
    ...(place.label ? { label: place.label } : {}),
    location: place.stopId
      ? { stopLocation: { stopLocationId: place.stopId } }
      : { coordinate: { latitude: place.lat, longitude: place.lon } },
  };
}

/** One OTP search: the request's options with its own endpoints and time. */
export interface SearchInput {
  from: PlaceInput;
  to: PlaceInput;
  /** ISO-8601 with offset. */
  time: string;
  arriveBy: boolean;
  first: number;
  cursor?: string;
}

/** Map a search onto OTP `planConnection` variables, with the request's modes and locale. */
export function searchVariables(req: PlanRequest, search: SearchInput): Record<string, unknown> {
  const streetModes = req.bikeShare ? ["WALK", "BICYCLE_RENTAL"] : ["WALK"];
  return {
    origin: location(search.from),
    destination: location(search.to),
    dateTime: search.arriveBy ? { latestArrival: search.time } : { earliestDeparture: search.time },
    modes: {
      direct: streetModes,
      transit: {
        access: streetModes,
        egress: streetModes,
        transfer: ["WALK"],
        ...(req.transitModes ? { transit: req.transitModes.map((mode) => ({ mode })) } : {}),
      },
    },
    first: search.first,
    locale: otpLocale(req.locale),
    ...(search.cursor ? cursorVariables(search.cursor) : {}),
  };
}

/**
 * OTP variables for a trip without stops. Trips with stops are planned segment by segment
 * (`planWithStops`), because one OTP via search takes 18-24 s on the full-Taiwan graph.
 */
export function buildPlanVariables(req: PlanRequest, now: Date = new Date()): Record<string, unknown> {
  return searchVariables(req, {
    from: req.from,
    to: req.to,
    time: req.time ?? toTaipeiIso(now),
    arriveBy: req.arriveBy,
    first: 5,
    ...(req.cursor ? { cursor: req.cursor } : {}),
  });
}

/** Cursors we hand out are prefixed with the direction so one field serves both. */
function cursorVariables(cursor: string): Record<string, string> {
  if (cursor.startsWith("next:")) return { after: cursor.slice(5) };
  if (cursor.startsWith("prev:")) return { before: cursor.slice(5) };
  return { after: cursor };
}

function otpLocale(locale: PlanRequest["locale"]): string {
  return locale === "zh-TW" ? "zh_TW" : locale;
}

/** ISO-8601 with +08:00 offset for Asia/Taipei (no DST). */
export function toTaipeiIso(d: Date): string {
  const shifted = new Date(d.getTime() + 8 * 3600_000);
  return `${shifted.toISOString().slice(0, 19)}+08:00`;
}
