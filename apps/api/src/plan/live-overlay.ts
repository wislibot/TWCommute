import type { Itinerary, Leg } from "@twc/contracts";
import { localId, tdxRouteKey } from "../lib/ids";
import type { EtaQuery, EtaResult, IngestClient } from "../lib/ingest-client";

/**
 * TDX does not publish GTFS-Realtime for buses yet, so OTP routes buses on timetables.
 * For bus legs leaving soon, we attach TDX's live "next bus at this stop" ETA so the app can
 * show "arrives in 6 min" next to the scheduled time.
 *
 * Id mapping (verified in the Phase 0 audit, docs/DATA.md): GTFS stop_id = TDX StopUID and
 * route_id = `<SubRouteUID>_<Direction>`.
 */
export function etaQueryForLeg(leg: Leg): EtaQuery | null {
  if (leg.mode !== "BUS" && leg.mode !== "COACH") return null;
  const stopUid = localId(leg.from.stopId);
  const route = tdxRouteKey(leg.route?.id);
  if (!stopUid || !route) return null;
  return { stopUid, ...route };
}

function isLeavingSoon(leg: Leg, now: Date, windowMinutes: number): boolean {
  const departs = Date.parse(leg.start.scheduled);
  return (
    Number.isFinite(departs) &&
    departs - now.getTime() <= windowMinutes * 60_000 &&
    departs >= now.getTime() - 5 * 60_000
  );
}

/**
 * TDX's ETA is for the next bus at the stop. If that bus comes this much earlier than the one the
 * leg is planned on, it is a different bus (the leg waits for a later one), so it is not shown.
 */
export const ETA_MATCH_TOLERANCE_MS = 10 * 60_000;

export function applyEta(leg: Leg, eta: EtaResult | null): Leg {
  if (!eta || eta.etaSeconds === null) return leg;
  const predicted = Date.parse(eta.asOf) + eta.etaSeconds * 1000;
  if (Date.parse(leg.start.scheduled) - predicted > ETA_MATCH_TOLERANCE_MS) return leg;
  return {
    ...leg,
    realtime: "live",
    live: { etaSeconds: eta.etaSeconds, asOf: eta.asOf, source: "tdx-eta", isLastBus: eta.isLastBus },
  };
}

/** Attach live ETAs to every eligible bus leg with a single batched ingest call. */
export async function overlayLiveBus(
  itineraries: Itinerary[],
  ingest: Pick<IngestClient, "busEta">,
  now: Date,
  windowMinutes: number,
): Promise<Itinerary[]> {
  const targets: Array<{ it: number; leg: number; query: EtaQuery }> = [];
  for (const [i, it] of itineraries.entries()) {
    for (const [j, leg] of it.legs.entries()) {
      if (leg.realtime === "live" || !isLeavingSoon(leg, now, windowMinutes)) continue;
      const query = etaQueryForLeg(leg);
      if (query) targets.push({ it: i, leg: j, query });
    }
  }
  if (targets.length === 0) return itineraries;

  // The ingest endpoint accepts at most 50 queries per call.
  const batch = targets.slice(0, 50);
  let results: (EtaResult | null)[];
  try {
    results = await ingest.busEta(batch.map((t) => t.query));
  } catch {
    return itineraries; // Live data is best-effort; schedules are still correct to show.
  }
  const out = itineraries.map((it) => ({ ...it, legs: [...it.legs] }));
  for (const [k, t] of batch.entries()) {
    const it = out[t.it];
    const leg = it?.legs[t.leg];
    if (it && leg) it.legs[t.leg] = applyEta(leg, results[k] ?? null);
  }
  return out;
}
