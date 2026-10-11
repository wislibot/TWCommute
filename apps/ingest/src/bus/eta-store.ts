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

/**
 * Latest bus ETAs (TDX N1) for every polled city, indexed by stop. A city's entries are
 * replaced atomically on each poll so stale rows never linger.
 */
export class BusEtaStore {
  private byFeed = new Map<string, Map<string, EtaResult[]>>();
  /** SubRouteUID → RouteUID, from TDX route lists (per feed). */
  private parentsByFeed = new Map<string, Map<string, string>>();

  /**
   * Remember which route each sub-route belongs to. Taipei and New Taipei ETA rows carry only
   * RouteUID, while GTFS route ids use the sub-route (Phase 0 audit), so this links the two.
   */
  setRoutes(feed: string, routes: TdxBusRoute[]): number {
    const parents = new Map<string, string>();
    for (const r of routes) {
      if (!r?.RouteUID) continue;
      for (const s of Array.isArray(r.SubRoutes) ? r.SubRoutes : []) {
        if (s?.SubRouteUID) parents.set(s.SubRouteUID, r.RouteUID);
      }
    }
    this.parentsByFeed.set(feed, parents);
    return parents.size;
  }

  private parentOf(subRouteUid: string): string | undefined {
    for (const parents of this.parentsByFeed.values()) {
      const hit = parents.get(subRouteUid);
      if (hit) return hit;
    }
    return undefined;
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

  /**
   * Best match for a stop + route (+ direction). A sub-route key matches rows with that sub-route,
   * rows whose route id equals it (no separate sub-route), and rows without a sub-route whose route
   * is the sub-route's parent (Taipei/New Taipei feeds).
   */
  find(q: EtaQuery): EtaResult | null {
    const parent = q.subRouteUid ? this.parentOf(q.subRouteUid) : undefined;
    const candidates = this.atStop(q.stopUid).filter(
      (e) =>
        (q.subRouteUid
          ? e.subRouteUid === q.subRouteUid ||
            e.routeUid === q.subRouteUid ||
            (!e.subRouteUid && parent !== undefined && e.routeUid === parent)
          : true) &&
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
