import type { TdxBusEta, TdxBusRoute } from "@twc/tdx";
import type { StopPosition } from "../gtfs/indexes";

export interface EtaQuery {
  stopUid: string;
  routeUid?: string;
  subRouteUid?: string;
  /** TDX direction: 0 outbound, 1 inbound, 2 loop. */
  direction?: number;
  /**
   * Where the rider gets off (trip legs). A route-level ETA at a stop several variants serve is
   * still right for the leg when every one of those variants also stops here: any of them will do.
   */
  toStopUid?: string;
}

export interface EtaResult {
  stopUid: string;
  routeUid: string;
  subRouteUid?: string;
  direction: number;
  /** Seconds until arrival; null when not running / not stopping / no vehicle. */
  etaSeconds: number | null;
  stopStatus: number;
  isLastBus: boolean;
  nextBusTime?: string;
  /** When TDX's source produced this estimate (falls back to TDX update time). */
  asOf: string;
}

/** Sub-routes of each TDX route per direction, from TDX's static route list. */
export class SubRouteIndex {
  private byRouteDir = new Map<string, Set<string>>();
  readonly size: number;

  constructor(routes: readonly (TdxBusRoute | null | undefined)[]) {
    const all = new Set<string>();
    for (const r of routes) {
      if (!r?.RouteUID) continue;
      for (const s of Array.isArray(r.SubRoutes) ? r.SubRoutes : []) {
        if (!s?.SubRouteUID) continue;
        // A sub-route without a direction counts in every direction.
        const key = `${r.RouteUID}|${s.Direction ?? "*"}`;
        const set = this.byRouteDir.get(key) ?? new Set<string>();
        set.add(s.SubRouteUID);
        this.byRouteDir.set(key, set);
        all.add(s.SubRouteUID);
      }
    }
    this.size = all.size;
  }

  /** The route's sub-routes in this direction (empty when the route is not in the list). */
  variants(routeUid: string, direction: number): ReadonlySet<string> {
    return new Set([
      ...(this.byRouteDir.get(`${routeUid}|${direction}`) ?? []),
      ...(this.byRouteDir.get(`${routeUid}|*`) ?? []),
    ]);
  }
}

/**
 * Of a route's variants in a direction, those that stop at this stop according to the GTFS
 * (`served`: `<SubRouteUID>|<Direction>` keys at the stop). 685 and 685經吉林 share many stops but
 * not all; at a stop only one of them serves, a route-level ETA can only be for that one. Without
 * stop data, or when the GTFS lists none of the variants there, all variants are kept.
 */
export function variantsAtStop(
  all: ReadonlySet<string>,
  direction: number,
  served: { has(key: string): boolean } | undefined,
): ReadonlySet<string> {
  if (!served || all.size <= 1) return all;
  const here = new Set([...all].filter((s) => served.has(`${s}|${direction}`)));
  return here.size > 0 ? here : all;
}

/** The fields of an ETA row that decide which GTFS route it belongs to. */
export type EtaRouteFields = Pick<EtaResult, "routeUid" | "subRouteUid" | "direction">;

/** A route's sub-routes in a direction; empty when unknown. */
export type VariantLookup = (routeUid: string, direction: number) => ReadonlySet<string>;

/**
 * Does a TDX ETA row describe buses of this GTFS sub-route (`<SubRouteUID>` from the GTFS
 * route id `<SubRouteUID>_<Direction>`)?
 * - A row that names its sub-route matches only that sub-route.
 * - A row without one (Taipei, New Taipei) matches when its route has exactly this one sub-route
 *   in the row's direction. With several variants (e.g. 685 and 685經吉林, where the main variant
 *   reuses the route's id) the row could be any of them, so it is not attached.
 * - When the route list does not know the route, the row matches the route id itself.
 * The Phase 0 audit (src/audit/bus-mapping.ts) measures joins with this same rule.
 */
export function etaServesSubRoute(e: EtaRouteFields, subRouteUid: string, variantsOf: VariantLookup): boolean {
  if (e.subRouteUid) return e.subRouteUid === subRouteUid;
  const variants = variantsOf(e.routeUid, e.direction);
  if (variants.size === 0) return e.routeUid === subRouteUid;
  return variants.size === 1 && variants.has(subRouteUid);
}

/**
 * Latest bus ETAs (TDX N1) for every polled city, indexed by stop. A city's entries are
 * replaced atomically on each poll so stale rows never linger.
 */
export class BusEtaStore {
  private byFeed = new Map<string, Map<string, EtaResult[]>>();
  /** Sub-route lists per feed, replaced on each refresh. */
  private routesByFeed = new Map<string, SubRouteIndex>();

  /**
   * Remember each route's sub-routes. Taipei and New Taipei ETA rows carry only RouteUID, while
   * GTFS route ids use the sub-route (Phase 0 audit), so this links the two.
   */
  setRoutes(feed: string, routes: TdxBusRoute[]): number {
    const index = new SubRouteIndex(routes);
    this.routesByFeed.set(feed, index);
    return index.size;
  }

  private variantsOf: VariantLookup = (routeUid, direction) => {
    for (const index of this.routesByFeed.values()) {
      const hit = index.variants(routeUid, direction);
      if (hit.size > 0) return hit;
    }
    return new Set();
  };

  /** Bus sub-routes serving each stop and where on them, from the GTFS (see `variantsAtStop`). */
  private stopRoutes: ReadonlyMap<string, ReadonlyMap<string, StopPosition>> = new Map();

  setStopRoutes(index: ReadonlyMap<string, ReadonlyMap<string, StopPosition>>): void {
    this.stopRoutes = index;
  }

  replace(feed: string, rows: TdxBusEta[]): number {
    const byStop = new Map<string, EtaResult[]>();
    for (const r of rows) {
      if (!r.StopUID || !r.RouteUID) continue;
      const entry: EtaResult = {
        stopUid: r.StopUID,
        routeUid: r.RouteUID,
        subRouteUid: r.SubRouteUID,
        direction: r.Direction,
        etaSeconds: typeof r.EstimateTime === "number" ? r.EstimateTime : null,
        stopStatus: r.StopStatus ?? 0,
        isLastBus: r.IsLastBus ?? false,
        nextBusTime: r.NextBusTime,
        asOf: r.SrcUpdateTime ?? r.UpdateTime ?? new Date().toISOString(),
      };
      const list = byStop.get(r.StopUID);
      if (list) list.push(entry);
      else byStop.set(r.StopUID, [entry]);
    }
    this.byFeed.set(feed, byStop);
    return byStop.size;
  }

  /** All routes' ETAs at a stop. */
  atStop(stopUid: string): EtaResult[] {
    for (const byStop of this.byFeed.values()) {
      const hit = byStop.get(stopUid);
      if (hit) return hit;
    }
    return [];
  }

  /** Best match for a stop + route (+ direction); see `etaServesSubRoute` for the route rule. */
  find(q: EtaQuery): EtaResult | null {
    const served = this.stopRoutes.get(q.stopUid);
    const alighting = q.toStopUid ? this.stopRoutes.get(q.toStopUid) : undefined;
    const variantsHere: VariantLookup = (route, direction) => {
      const here = variantsAtStop(this.variantsOf(route, direction), direction, served);
      // Several variants here, all going on to the rider's stop (after this one): whichever comes
      // next is the one to take.
      if (here.size > 1 && served && alighting && q.subRouteUid && here.has(q.subRouteUid)) {
        const all = [...here].every((v) => {
          const from = served.get(`${v}|${direction}`);
          const to = alighting.get(`${v}|${direction}`);
          return from !== undefined && to !== undefined && to.last > from.first;
        });
        if (all) return new Set([q.subRouteUid]);
      }
      return here;
    };
    const candidates = this.atStop(q.stopUid).filter(
      (e) =>
        (q.subRouteUid ? etaServesSubRoute(e, q.subRouteUid, variantsHere) : true) &&
        (q.routeUid ? e.routeUid === q.routeUid || e.subRouteUid === q.routeUid : true) &&
        (q.direction === undefined ? true : e.direction === q.direction),
    );
    if (candidates.length === 0) return null;
    // Prefer an actual prediction, then the soonest one.
    return (
      candidates.sort(
        (a, b) => (a.etaSeconds ?? Number.POSITIVE_INFINITY) - (b.etaSeconds ?? Number.POSITIVE_INFINITY),
      )[0] ?? null
    );
  }

  size(): number {
    let n = 0;
    for (const m of this.byFeed.values()) n += m.size;
    return n;
  }
}
