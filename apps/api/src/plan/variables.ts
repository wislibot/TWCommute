import type { PlaceInput, PlanRequest } from "@twc/contracts";

/** OTP Duration scalar (ISO-8601), e.g. 90 → "PT90M". */
export function minutesToDuration(minutes: number): string {
  return minutes <= 0 ? "PT0S" : `PT${Math.round(minutes)}M`;
}

function location(place: PlaceInput) {
  return {
    ...(place.label ? { label: place.label } : {}),
    location: place.stopId
      ? { stopLocation: { stopLocationId: place.stopId } }
      : { coordinate: { latitude: place.lat, longitude: place.lon } },
  };
}

/** Map our PlanRequest onto OTP `planConnection` variables. */
export function buildPlanVariables(req: PlanRequest, now: Date = new Date()): Record<string, unknown> {
  const time = req.time ?? toTaipeiIso(now);
  const streetModes = req.bikeShare ? ["WALK", "BICYCLE_RENTAL"] : ["WALK"];
  return {
    origin: location(req.from),
    destination: location(req.to),
    via: req.vias.map((v) => ({
      visit: {
        ...(v.place.label ? { label: v.place.label } : {}),
        minimumWaitTime: minutesToDuration(v.dwellMinutes),
        ...(v.place.stopId
          ? { stopLocationIds: [v.place.stopId] }
          : { coordinate: { latitude: v.place.lat, longitude: v.place.lon } }),
      },
    })),
    dateTime: req.arriveBy ? { latestArrival: time } : { earliestDeparture: time },
    modes: {
      direct: streetModes,
      transit: {
        access: streetModes,
        egress: streetModes,
        transfer: ["WALK"],
        ...(req.transitModes ? { transit: req.transitModes.map((mode) => ({ mode })) } : {}),
      },
    },
    first: 5,
    locale: otpLocale(req.locale),
    ...(req.cursor ? cursorVariables(req.cursor) : {}),
  };
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
