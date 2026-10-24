import type { HealthResponse, Itinerary, ServiceAlert } from "@twc/contracts";
import { cityFromUid } from "@twc/fares";
import type { EtaResult } from "../lib/ingest-client";

/**
 * Taiwan local hours when every city has buses on the road. Outside them a feed without a single
 * live prediction proves nothing (night, first buses not out yet).
 */
const SERVICE_HOURS = { from: 7, to: 21 };

/** An operator that is silent now says something about buses leaving soon, not about tomorrow's. */
export const SILENT_FEED_HORIZON_MS = 3 * 3600_000;

/** The TDX ETA feed a bus stop belongs to: its city's, or InterCity for 公路客運 stops (`THB…`). */
export function feedOfStop(stopUid: string | undefined): string | null {
  if (!stopUid) return null;
  const local = stopUid.includes(":") ? stopUid.slice(stopUid.indexOf(":") + 1) : stopUid;
  return cityFromUid(local) ?? (/^THB/i.test(local) ? "InterCity" : null);
}

/**
 * Bus feeds that are up to date (polled within three intervals) yet report no live bus anywhere,
 * during service hours: the operator's buses are most likely not running (e.g. a typhoon
 * suspension). Measured counts are in `/v1/health` → `busLive`.
 */
export function silentFeeds(health: HealthResponse | null, now: Date): ReadonlySet<string> {
  const hour = (now.getUTCHours() + 8) % 24;
  if (!health?.busLive || hour < SERVICE_HOURS.from || hour >= SERVICE_HOURS.to) return new Set();
  const fresh = new Set(health.feeds.filter((f) => f.healthy).map((f) => f.feed));
  return new Set(
    Object.entries(health.busLive)
      .filter(([feed, live]) => live === 0 && fresh.has(`bus-eta:${feed}`))
      .map(([feed]) => feed),
  );
}

/** Why a bus from this stop may not run; undefined when nothing suggests so. */
export function serviceAlert(
  stopUid: string | undefined,
  eta: EtaResult | null | undefined,
  silent: ReadonlySet<string>,
): ServiceAlert | undefined {
  if (eta?.stopStatus === 4) return "not_operating_today";
  const feed = feedOfStop(stopUid);
  return feed && silent.has(feed) ? "no_live_service" : undefined;
}

/** Warn on bus legs leaving within `SILENT_FEED_HORIZON_MS` whose operator is silent. */
export function markSilentFeeds(itineraries: Itinerary[], silent: ReadonlySet<string>, now: Date): Itinerary[] {
  if (silent.size === 0) return itineraries;
  return itineraries.map((it) => ({
    ...it,
    legs: it.legs.map((leg) => {
      if ((leg.mode !== "BUS" && leg.mode !== "COACH") || leg.serviceAlert || leg.realtime === "live") return leg;
      const departs = Date.parse(leg.start.scheduled) - now.getTime();
      if (!(departs <= SILENT_FEED_HORIZON_MS && departs >= -5 * 60_000)) return leg;
      const alert = serviceAlert(leg.from.stopId, null, silent);
      return alert ? { ...leg, serviceAlert: alert } : leg;
    }),
  }));
}
