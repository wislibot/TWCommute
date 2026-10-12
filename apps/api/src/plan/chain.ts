import type { Itinerary, Leg, LegTime, PlaceInput, PlanError, PlanRequest } from "@twc/contracts";
import type { OtpClient } from "../otp/client";
import { PLAN_QUERY } from "../otp/queries";
import type { OtpPlanData } from "../otp/types";
import { mapItinerary } from "./map";
import { type SearchInput, searchVariables, toTaipeiIso } from "./variables";

/**
 * Trips with stops ("visit Dihua St for 90 minutes on the way to Tamsui") are planned as one
 * ordinary OTP search per segment, joined at each stop with the requested stay. OTP 2.10 can do
 * this in one via search, but on the full-Taiwan graph that takes 18-24 s against 2-3 s per plain
 * search (Phase 0, docs/DATA.md).
 *
 * Leaving at a time: the first segment is searched from that time; each later segment once, from
 * the earliest moment any option can leave the stop (arrival + stay). Every option then continues
 * with the later-segment option that arrives first among those leaving after its stay. Walking or
 * cycling options are not tied to a departure, so they are moved to leave right when the stay ends.
 * Arriving by a time works the same way backwards from the last segment. A stay is therefore at
 * least what was asked for, and any slack is spent at the stop rather than at the next bus stop.
 */
export const FIRST_SEGMENT_OPTIONS = 5;
/** Later segments are searched once for all options, so they ask for more. */
export const LATER_SEGMENT_OPTIONS = 10;

export interface ChainedPlan {
  itineraries: Itinerary[];
  errors: PlanError[];
  nextCursor?: string;
  previousCursor?: string;
}

const legStart = (l: Leg) => Date.parse(l.start.estimated ?? l.start.scheduled);
const legEnd = (l: Leg) => Date.parse(l.end.estimated ?? l.end.scheduled);
const startOf = (it: Itinerary) => legStart(it.legs[0] as Leg);
const endOf = (it: Itinerary) => legEnd(it.legs.at(-1) as Leg);

/** Walking and cycling (own or YouBike) can start whenever the traveler is ready; transit cannot. */
const streetOnly = (it: Itinerary) => it.legs.every((l) => l.mode === "WALK" || l.mode === "BICYCLE");

const shiftIso = (iso: string, ms: number) => toTaipeiIso(new Date(Date.parse(iso) + ms));
const shiftTime = (t: LegTime, ms: number): LegTime => ({
  ...t,
  scheduled: shiftIso(t.scheduled, ms),
  ...(t.estimated ? { estimated: shiftIso(t.estimated, ms) } : {}),
});

/** The same walk or ride, `ms` later (earlier when negative). */
function retime(it: Itinerary, ms: number): Itinerary {
  if (ms === 0) return it;
  return {
    ...it,
    id: `${it.id}@${Math.round(ms / 1000)}`,
    start: shiftIso(it.start, ms),
    end: shiftIso(it.end, ms),
    legs: it.legs.map((l) => ({ ...l, start: shiftTime(l.start, ms), end: shiftTime(l.end, ms) })),
  };
}

/** Cursors for trips with stops carry the time of the next page: `at:<ISO-8601>`. */
export function cursorTime(cursor: string | undefined): string | undefined {
  if (!cursor?.startsWith("at:")) return undefined;
  const iso = cursor.slice(3);
  return Number.isFinite(Date.parse(iso)) && /[+-]\d{2}:\d{2}$|Z$/.test(iso) ? iso : undefined;
}

/** Two places closer than ~10 m (or the same stop) need no trip between them. */
function samePlace(a: PlaceInput, b: PlaceInput): boolean {
  if (a.stopId && b.stopId) return a.stopId === b.stopId;
  return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;
}

const point = (place: PlaceInput) => ({
  name: place.label ?? "",
  lat: place.lat,
  lon: place.lon,
  ...(place.stopId ? { stopId: place.stopId } : {}),
});

/**
 * A zero-length segment for a stop at the same place as the previous or next one. Each end keeps
 * its own name, so the app shows the stay at the stop the user named.
 */
function stayHere(from: PlaceInput, to: PlaceInput, at: string, segment: number): Itinerary {
  return {
    id: `s${segment}.here`,
    start: at,
    end: at,
    durationSeconds: 0,
    transfers: 0,
    walkDistanceMeters: 0,
    legs: [
      {
        mode: "WALK",
        from: point(from),
        to: point(to),
        start: { scheduled: at },
        end: { scheduled: at },
        durationSeconds: 0,
        distanceMeters: 0,
        realtime: "scheduled",
        rentedBike: false,
      },
    ],
  };
}

async function searchSegment(
  req: PlanRequest,
  otp: Pick<OtpClient, "query">,
  search: SearchInput,
  segment: number,
): Promise<{ options: Itinerary[]; errors: PlanError[] }> {
  if (samePlace(search.from, search.to)) {
    return { options: [stayHere(search.from, search.to, search.time, segment)], errors: [] };
  }
  const data = await otp.query<OtpPlanData>(PLAN_QUERY, searchVariables(req, search), req.locale);
  const conn = data.planConnection;
  const options = (conn?.edges ?? [])
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .map((e, i) => mapItinerary(e.node, `s${segment}.${i}`))
    .filter((it) => it.legs.length > 0);
  const errors = (conn?.routingErrors ?? []).map((e) => ({
    code: e.code,
    message: `Segment ${segment + 1}: ${e.description}`,
  }));
  return { options, errors };
}

/**
 * Keep what nothing beats on both leaving time (later is better) and arrival time (earlier is
 * better); of identical ones the first. Sorted by leaving, then arrival time.
 */
function pareto<T>(items: T[], start: (t: T) => number, end: (t: T) => number): T[] {
  return items
    .filter(
      (c, i) =>
        !items.some(
          (d, j) =>
            j !== i && start(d) >= start(c) && end(d) <= end(c) && (start(d) > start(c) || end(d) < end(c) || j < i),
        ),
    )
    .sort((a, b) => start(a) - start(b) || end(a) - end(b));
}

/** Leaving at or after `readyMs`: the option arriving first (then leaving last). */
function continueAfter(options: Itinerary[], readyMs: number): Itinerary | undefined {
  return options
    .map((o) => (streetOnly(o) ? retime(o, readyMs - startOf(o)) : o))
    .filter((o) => startOf(o) >= readyMs)
    .sort((a, b) => endOf(a) - endOf(b) || startOf(b) - startOf(a))[0];
}

/** Arriving at or before `leaveByMs`: the option leaving last (then arriving first). */
function arriveBefore(options: Itinerary[], leaveByMs: number): Itinerary | undefined {
  return options
    .map((o) => (streetOnly(o) ? retime(o, leaveByMs - endOf(o)) : o))
    .filter((o) => endOf(o) <= leaveByMs)
    .sort((a, b) => startOf(b) - startOf(a) || endOf(a) - endOf(b))[0];
}

/** Mark the legs where the traveler arrives at and leaves each stop, and add the segments up. */
export function joinSegments(segments: Itinerary[]): Itinerary {
  const legs = segments.flatMap((it, s) =>
    it.legs.map((leg, j) => {
      const toVia = s < segments.length - 1 && j === it.legs.length - 1 ? s : undefined;
      const fromVia = s > 0 && j === 0 ? s - 1 : undefined;
      if (toVia === undefined && fromVia === undefined) return leg;
      return {
        ...leg,
        ...(fromVia !== undefined ? { from: { ...leg.from, viaIndex: fromVia } } : {}),
        ...(toVia !== undefined ? { to: { ...leg.to, viaIndex: toVia } } : {}),
      };
    }),
  );
  const first = segments[0] as Itinerary;
  const last = segments.at(-1) as Itinerary;
  return {
    id: segments.map((s) => s.id).join("+"),
    start: first.start,
    end: last.end,
    durationSeconds: Math.round((Date.parse(last.end) - Date.parse(first.start)) / 1000),
    transfers: segments.reduce((n, s) => n + s.transfers, 0),
    walkDistanceMeters: segments.reduce((n, s) => n + s.walkDistanceMeters, 0),
    legs,
  };
}

type Chain = Itinerary[];
const chainStart = (c: Chain) => startOf(c[0] as Itinerary);
const chainEnd = (c: Chain) => endOf(c.at(-1) as Itinerary);

/**
 * How much later the first segment could leave (or, from the end, how much earlier the last could
 * arrive) and still make the same transit: the spare time at each stop beyond its stay, added up
 * from that end across walking and zero-length segments until the first transit segment.
 */
function slack(c: Chain, stayMs: number[], fromEnd = false): number {
  let total = 0;
  for (let k = 0; k + 1 < c.length; k++) {
    const s = fromEnd ? c.length - 2 - k : k;
    total += Math.max(0, startOf(c[s + 1] as Itinerary) - endOf(c[s] as Itinerary) - (stayMs[s] ?? 0));
    // The segment on the far side of this stop: transit cannot move, so the slack ends there.
    if (!streetOnly(c[fromEnd ? s : s + 1] as Itinerary)) break;
  }
  return total;
}

/**
 * When few ways reach the stops (a short walk or YouBike ride has one best option), fill the list
 * up to `FIRST_SEGMENT_OPTIONS` with longer stays: the later departures from the last stop (or,
 * arriving by a time, earlier arrivals at the first stop) that nothing else beats.
 */
function withLongerStays(best: Chain[], alternatives: (c: Chain) => Chain[]): Chain[] {
  const out = [...best];
  for (const c of best) {
    for (const alt of alternatives(c)) {
      if (out.length >= FIRST_SEGMENT_OPTIONS) break;
      out.push(alt);
    }
  }
  return out.sort((a, b) => chainStart(a) - chainStart(b) || chainEnd(a) - chainEnd(b));
}

export async function planWithStops(req: PlanRequest, otp: Pick<OtpClient, "query">, now: Date): Promise<ChainedPlan> {
  const places = [req.from, ...req.vias.map((v) => v.place), req.to];
  const stayMs = req.vias.map((v) => v.dwellMinutes * 60_000);
  const segments = places.length - 1;
  const time = cursorTime(req.cursor) ?? req.time ?? toTaipeiIso(now);
  const errors: PlanError[] = [];
  const search = async (segment: number, at: string, arriveBy: boolean, first: number) => {
    const result = await searchSegment(
      req,
      otp,
      {
        from: places[segment] as PlaceInput,
        to: places[segment + 1] as PlaceInput,
        time: at,
        arriveBy,
        first,
      },
      segment,
    );
    // OTP also reports notes alongside results (e.g. WALKING_BETTER_THAN_TRANSIT for a short hop
    // between two stops); only a segment with no way through explains a failed plan.
    if (result.options.length === 0) errors.push(...result.errors);
    return result.options;
  };

  let chains: Chain[];
  let alternatives: (c: Chain) => Chain[] = () => [];
  if (!req.arriveBy) {
    chains = (await search(0, time, false, FIRST_SEGMENT_OPTIONS)).map((o) => [o]);
    for (let s = 1; s < segments && chains.length > 0; s++) {
      const ready = (head: Chain) => endOf(head.at(-1) as Itinerary) + (stayMs[s - 1] ?? 0);
      const earliest = Math.min(...chains.map(ready));
      const options = await search(s, toTaipeiIso(new Date(earliest)), false, LATER_SEGMENT_OPTIONS);
      chains = chains.flatMap((c) => {
        const next = continueAfter(options, ready(c));
        return next ? [[...c, next]] : [];
      });
      if (s === segments - 1) {
        // Longer stays: transit leaving the last stop later than the chosen continuation.
        alternatives = (c) => {
          const chosen = c.at(-1) as Itinerary;
          if (streetOnly(chosen)) return [];
          const later = options.filter((o) => !streetOnly(o) && startOf(o) > startOf(chosen));
          return pareto(later, startOf, endOf).map((o) => [...c.slice(0, -1), o]);
        };
      }
    }
  } else {
    chains = (await search(segments - 1, time, true, FIRST_SEGMENT_OPTIONS)).map((o) => [o]);
    for (let s = segments - 2; s >= 0 && chains.length > 0; s--) {
      const leaveBy = (tail: Chain) => startOf(tail[0] as Itinerary) - (stayMs[s] ?? 0);
      const latest = Math.max(...chains.map(leaveBy));
      const options = await search(s, toTaipeiIso(new Date(latest)), true, LATER_SEGMENT_OPTIONS);
      chains = chains.flatMap((c) => {
        const prev = arriveBefore(options, leaveBy(c));
        return prev ? [[prev, ...c]] : [];
      });
      if (s === 0) {
        // Longer stays: transit reaching the first stop earlier than the chosen one.
        alternatives = (c) => {
          const chosen = c[0] as Itinerary;
          if (streetOnly(chosen)) return [];
          const earlier = options.filter((o) => !streetOnly(o) && endOf(o) < endOf(chosen));
          return pareto(earlier, startOf, endOf)
            .reverse()
            .map((o) => [o, ...c.slice(1)]);
        };
      }
    }
  }

  const unique = [...new Map(chains.map((c) => [c.map((s) => s.id).join("+"), c])).values()];
  const best = withLongerStays(pareto(unique, chainStart, chainEnd), alternatives);
  const itineraries = best.map(joinSegments);
  if (itineraries.length === 0 && errors.length === 0) {
    errors.push({ code: "NO_RESULT", message: "No connection keeps the requested stays" });
  }

  // Paging moves the search time past everything shown. A walk or ride is not tied to a departure,
  // so it could leave as late as its slack at the stops allows; transit leaves when it leaves.
  const page: Pick<ChainedPlan, "nextCursor" | "previousCursor"> = {};
  if (best.length > 0 && !req.arriveBy) {
    const lastLeave = Math.max(
      ...best.map((c) => chainStart(c) + (streetOnly(c[0] as Itinerary) ? slack(c, stayMs) : 0)),
    );
    page.nextCursor = `at:${toTaipeiIso(new Date(lastLeave + 60_000))}`;
  } else if (best.length > 0) {
    const firstArrive = Math.min(
      ...best.map((c) => chainEnd(c) - (streetOnly(c.at(-1) as Itinerary) ? slack(c, stayMs, true) : 0)),
    );
    page.previousCursor = `at:${toTaipeiIso(new Date(firstArrive - 60_000))}`;
  }
  return { itineraries, errors, ...page };
}
