import type { TdxBusEta, TdxBusRoute } from "@twc/tdx";

export interface EtaQuery {
  stopUid: string;
  routeUid?: string;
  subRouteUid?: string;
  /** TDX direction: 0 outbound, 1 inbound, 2 loop. */
  direction?: number;
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

  /** The route's only sub-route in this direction; undefined when it has none or several. */
  soleSubRoute(routeUid: string, direction: number): string | undefined {
    const subs = new Set([
      ...(this.byRouteDir.get(`${routeUid}|${direction}`) ?? []),
      ...(this.byRouteDir.get(`${routeUid}|*`) ?? []),
    ]);
    return subs.size === 1 ? [...subs][0] : undefined;
  }
}

/** The fields of an ETA row that decide which GTFS route it belongs to. */
export type EtaRouteFields = Pick<EtaResult, "routeUid" | "subRouteUid" | "direction">;

/**
 * Does a TDX ETA row describe buses of this GTFS sub-route (`<SubRouteUID>` from the GTFS
 * route id `<SubRouteUID>_<Direction>`)? It does when the row names that sub-route, when the
 * GTFS key is the route itself (no separate sub-routes), or when the row has no sub-route
 * (Taipei, New Taipei) and its route has exactly this one sub-route in the row's direction.
 * With several variants in a direction a route-level row could be any of them, so it is not
 * attached. The Phase 0 audit (src/audit/bus-mapping.ts) measures joins with this same rule.
 */
export function etaServesSubRoute(
  e: EtaRouteFields,
  subRouteUid: string,
  soleSubRoute: (routeUid: string, direction: number) => string | undefined,
): boolean {
  if (e.subRouteUid === subRouteUid || e.routeUid === subRouteUid) return true;
  return !e.subRouteUid && soleSubRoute(e.routeUid, e.direction) === subRouteUid;
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

  private soleSubRoute = (routeUid: string, direction: number): string | undefined => {
    for (const index of this.routesByFeed.values()) {
      const hit = index.soleSubRoute(routeUid, direction);
      if (hit) return hit;
    }
    return undefined;
  };

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
    const candidates = this.atStop(q.stopUid).filter(
      (e) =>
        (q.subRouteUid ? etaServesSubRoute(e, q.subRouteUid, this.soleSubRoute) : true) &&
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
