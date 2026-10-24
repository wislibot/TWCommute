import type { Departure, StopSummary } from "@twc/contracts";

/** Nearby stops sharing a name (a bus stop's two directions, a station's platforms), as one place. */
export interface StopGroup {
  name: string;
  distanceMeters?: number;
  ids: string[];
  modes: StopSummary["modes"];
}

/**
 * Group nearby stops by name, nearest first, keeping at most `maxIds` stop ids in all so the home
 * screen asks for a bounded number of departure boards.
 */
export function groupStopsByName(stops: readonly StopSummary[], maxIds: number): StopGroup[] {
  const groups: StopGroup[] = [];
  let ids = 0;
  for (const s of stops) {
    if (ids >= maxIds) break;
    const group = groups.find((g) => g.name === s.name);
    if (group) {
      group.ids.push(s.id);
      for (const m of s.modes) if (!group.modes.includes(m)) group.modes.push(m);
    } else {
      groups.push({ name: s.name, distanceMeters: s.distanceMeters, ids: [s.id], modes: [...s.modes] });
    }
    ids++;
  }
  return groups;
}

/** When a departure leaves: the live prediction when there is one, else the (estimated) timetable. */
export function departureTime(d: Departure): number {
  if (d.live && d.live.etaSeconds !== null) return Date.parse(d.live.asOf) + d.live.etaSeconds * 1000;
  return Date.parse(d.estimated ?? d.scheduled);
}

/** Whole minutes from now, never negative. */
export function minutesFromNow(d: Departure, now: number): number {
  return Math.max(0, Math.round((departureTime(d) - now) / 60_000));
}

/**
 * The next departure of each route and direction, soonest first, at most `max`: what a rider
 * scanning a stop needs, as in Transit and Citymapper.
 */
export function nextByRoute(departures: readonly Departure[], now: number, max: number): Departure[] {
  const seen = new Set<string>();
  const out: Departure[] = [];
  const upcoming = departures
    .filter((d) => departureTime(d) >= now - 60_000)
    .sort((a, b) => departureTime(a) - departureTime(b));
  for (const d of upcoming) {
    const key = `${d.routeShortName ?? d.routeId}|${d.headsign ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
    if (out.length === max) break;
  }
  return out;
}
