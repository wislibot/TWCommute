import type { Leg } from "@twc/contracts";

/** Legs have no ids; mode + start time + origin is unique within an itinerary. */
export function legKey(leg: Leg): string {
  return `${leg.mode}-${leg.start.scheduled}-${leg.from.lat.toFixed(5)},${leg.from.lon.toFixed(5)}`;
}
