import type { Itinerary, Leg, PlanError, PlanRequest } from "@twc/contracts";
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
 * with the later-segment option that arrives first among those leaving after its stay. Arriving
 * by a time works the same way backwards from the last segment. A stay is therefore at least what
 * was asked for, and any slack is spent at the stop rather than at the next bus stop.
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

/** Cursors for trips with stops carry the time of the next page: `at:<ISO-8601>`. */
export function cursorTime(cursor: string | undefined): string | undefined {
  if (!cursor?.startsWith("at:")) return undefined;
  const iso = cursor.slice(3);
  return Number.isFinite(Date.parse(iso)) && /[+-]\d{2}:\d{2}$|Z$/.test(iso) ? iso : undefined;
}

async function searchSegment(
  req: PlanRequest,
  otp: Pick<OtpClient, "query">,
  search: SearchInput,
  segment: number,
): Promise<{ options: Itinerary[]; errors: PlanError[] }> {
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

/** Of the options leaving at or after `readyMs`, the one arriving first (then leaving latest). */
function firstToArrive(options: Itinerary[], readyMs: number): Itinerary | undefined {
  return options.filter((o) => startOf(o) >= readyMs).sort((a, b) => endOf(a) - endOf(b) || startOf(b) - startOf(a))[0];
}

/** Of the options arriving at or before `leaveByMs`, the one leaving last (then arriving first). */
function lastToLeave(options: Itinerary[], leaveByMs: number): Itinerary | undefined {
  return options.filter((o) => endOf(o) <= leaveByMs).sort((a, b) => startOf(b) - startOf(a) || endOf(a) - endOf(b))[0];
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

/** Drop options another option beats on both leaving time and arrival time. */
function keepBest(chains: Itinerary[][]): Itinerary[][] {
  const unique = new Map(chains.map((c) => [c.map((s) => s.id).join("+"), c]));
  const all = [...unique.values()];
  const start = (c: Itinerary[]) => startOf(c[0] as Itinerary);
  const end = (c: Itinerary[]) => endOf(c.at(-1) as Itinerary);
  return all
    .filter(
      (c, i) =>
        !all.some(
          (d, j) =>
            j !== i && start(d) >= start(c) && end(d) <= end(c) && (start(d) > start(c) || end(d) < end(c) || j < i),
        ),
    )
    .sort((a, b) => start(a) - start(b) || end(a) - end(b));
}

/**
 * When few ways exist to reach the stops (a short walk or YouBike ride has one best option), fill
 * the list with the next departures after the stay, i.e. longer stays at the last stop (or, arriving
 * by a time, earlier departures before the first one), up to `FIRST_SEGMENT_OPTIONS` options.
 */
function withLongerStays(best: Itinerary[][], alternatives: (c: Itinerary[]) => Itinerary[][]): Itinerary[][] {
  const out = [...best];
  for (const c of best) {
    for (const alt of alternatives(c)) {
      if (out.length >= FIRST_SEGMENT_OPTIONS) break;
      out.push(alt);
    }
  }
  const start = (c: Itinerary[]) => startOf(c[0] as Itinerary);
  const end = (c: Itinerary[]) => endOf(c.at(-1) as Itinerary);
  return out.sort((a, b) => start(a) - start(b) || end(a) - end(b));
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
        from: places[segment] as SearchInput["from"],
        to: places[segment + 1] as SearchInput["to"],
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

  let chains: Itinerary[][];
  // The segment searched last and how each chain may extend it: used to offer longer stays.
  let alternatives: (c: Itinerary[]) => Itinerary[][] = () => [];
  if (!req.arriveBy) {
    chains = (await search(0, time, false, FIRST_SEGMENT_OPTIONS)).map((o) => [o]);
    for (let s = 1; s < segments && chains.length > 0; s++) {
      const ready = (head: Itinerary[]) => endOf(head.at(-1) as Itinerary) + (stayMs[s - 1] ?? 0);
      const earliest = Math.min(...chains.map(ready));
      const options = await search(s, toTaipeiIso(new Date(earliest)), false, LATER_SEGMENT_OPTIONS);
      chains = chains.flatMap((c) => {
        const next = firstToArrive(options, ready(c));
        return next ? [[...c, next]] : [];
      });
      if (s === segments - 1) {
        alternatives = (c) => {
          const head = c.slice(0, -1);
          return options
            .filter((o) => o !== c.at(-1) && startOf(o) >= ready(head))
            .sort((a, b) => startOf(a) - startOf(b))
            .map((o) => [...head, o]);
        };
      }
    }
  } else {
    chains = (await search(segments - 1, time, true, FIRST_SEGMENT_OPTIONS)).map((o) => [o]);
    for (let s = segments - 2; s >= 0 && chains.length > 0; s--) {
      const leaveBy = (tail: Itinerary[]) => startOf(tail[0] as Itinerary) - (stayMs[s] ?? 0);
      const latest = Math.max(...chains.map(leaveBy));
      const options = await search(s, toTaipeiIso(new Date(latest)), true, LATER_SEGMENT_OPTIONS);
      chains = chains.flatMap((c) => {
        const prev = lastToLeave(options, leaveBy(c));
        return prev ? [[prev, ...c]] : [];
      });
      if (s === 0) {
        alternatives = (c) => {
          const tail = c.slice(1);
          return options
            .filter((o) => o !== c[0] && endOf(o) <= leaveBy(tail))
            .sort((a, b) => startOf(b) - startOf(a))
            .map((o) => [o, ...tail]);
        };
      }
    }
  }

  const best = withLongerStays(keepBest(chains), alternatives);
  const itineraries = best.map(joinSegments);
  if (itineraries.length === 0 && errors.length === 0) {
    errors.push({ code: "NO_RESULT", message: "No connection keeps the requested stays" });
  }
  // Paging moves the search time: later departures, or earlier arrivals when arriving by a time.
  const page: Pick<ChainedPlan, "nextCursor" | "previousCursor"> = {};
  if (best.length > 0 && !req.arriveBy) {
    const lastStart = Math.max(...best.map((c) => startOf(c[0] as Itinerary)));
    page.nextCursor = `at:${toTaipeiIso(new Date(lastStart + 60_000))}`;
  } else if (best.length > 0) {
    const firstEnd = Math.min(...best.map((c) => endOf(c.at(-1) as Itinerary)));
    page.previousCursor = `at:${toTaipeiIso(new Date(firstEnd - 60_000))}`;
  }
  return { itineraries, errors, ...page };
}
