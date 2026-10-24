import type { PlanRequest, PlanResponse } from "@twc/contracts";
import type { IngestClient } from "../lib/ingest-client";
import type { OtpClient } from "../otp/client";
import { PLAN_QUERY } from "../otp/queries";
import type { OtpPlanData } from "../otp/types";
import { planWithStops } from "./chain";
import { addDockRisk } from "./dock-risk";
import { overlayLiveBus } from "./live-overlay";
import { mapItinerary } from "./map";
import { markSilentFeeds, SILENT_FEED_HORIZON_MS, silentFeeds } from "./service-alert";
import { addTpassCoverage } from "./tpass";
import { buildPlanVariables } from "./variables";

export interface PlanDeps {
  otp: Pick<OtpClient, "query">;
  ingest: Pick<IngestClient, "busEta" | "bikesNearby"> & Partial<Pick<IngestClient, "health">>;
  liveWindowMinutes: number;
  now?: () => Date;
}

export async function plan(req: PlanRequest, deps: PlanDeps): Promise<PlanResponse> {
  const now = deps.now?.() ?? new Date();
  const routed = req.vias.length > 0 ? await planWithStops(req, deps.otp, now) : await planDirect(req, deps, now);

  let itineraries = routed.itineraries;
  const health = deps.ingest.health?.().catch(() => null) ?? Promise.resolve(null);
  itineraries = await overlayLiveBus(
    itineraries,
    deps.ingest,
    now,
    deps.liveWindowMinutes,
    SILENT_FEED_HORIZON_MS / 60_000,
  );
  itineraries = markSilentFeeds(itineraries, silentFeeds(await health, now), now);
  itineraries = await addDockRisk(itineraries, deps.ingest, now);
  itineraries = addTpassCoverage(itineraries, req.tpassId);
  return { ...routed, itineraries };
}

/** A trip without stops: one OTP search, paged with OTP's own cursors. */
async function planDirect(req: PlanRequest, deps: PlanDeps, now: Date): Promise<PlanResponse> {
  const data = await deps.otp.query<OtpPlanData>(PLAN_QUERY, buildPlanVariables(req, now), req.locale);
  const conn = data.planConnection;
  if (!conn) return { itineraries: [], errors: [{ code: "NO_RESULT", message: "Router returned no result" }] };
  return {
    itineraries: (conn.edges ?? [])
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .map((e, i) => mapItinerary(e.node, `${conn.pageInfo.startCursor ?? "p"}-${i}`)),
    errors: conn.routingErrors.map((e) => ({ code: e.code, message: e.description })),
    ...(conn.pageInfo.hasNextPage && conn.pageInfo.endCursor ? { nextCursor: `next:${conn.pageInfo.endCursor}` } : {}),
    ...(conn.pageInfo.hasPreviousPage && conn.pageInfo.startCursor
      ? { previousCursor: `prev:${conn.pageInfo.startCursor}` }
      : {}),
  };
}
