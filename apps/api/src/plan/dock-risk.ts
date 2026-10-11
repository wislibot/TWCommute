import type { DockInfo, DockRisk, Itinerary, Leg, RiskLevel } from "@twc/contracts";
import type { IngestClient } from "../lib/ingest-client";

export const FEW = 3;
/** Beyond this lead time, today's availability says little about arrival time. */
export const LONG_LEAD_MINUTES = 20;
export const BACKUP_RADIUS_METERS = 400;

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
const raise = (a: RiskLevel, b: RiskLevel): RiskLevel => (RANK[b] > RANK[a] ? b : a);

/**
 * Dock-risk v1: a heuristic on live availability at pickup and drop-off.
 * v2 (Phase 2) replaces it with per-station empty/full probabilities by time of day.
 */
export function assessDockRisk(leg: Leg, now: Date): DockRisk | undefined {
  if (!leg.rentedBike) return undefined;
  const pickup = leg.from.bikeStation;
  const dropoff = leg.to.bikeStation;
  let level: RiskLevel = "low";
  const reasons: DockRisk["reasons"] = [];

  if (pickup) {
    if (pickup.bikesAvailable === null) reasons.push("no_realtime");
    else if (pickup.bikesAvailable === 0) {
      level = raise(level, "high");
      reasons.push("no_bikes_at_pickup");
    } else if (pickup.bikesAvailable < FEW) {
      level = raise(level, "medium");
      reasons.push("few_bikes_at_pickup");
    }
  }
  if (dropoff) {
    if (dropoff.docksAvailable === null) {
      if (!reasons.includes("no_realtime")) reasons.push("no_realtime");
    } else if (dropoff.docksAvailable === 0) {
      level = raise(level, "high");
      reasons.push("no_docks_at_dropoff");
    } else if (dropoff.docksAvailable < FEW) {
      level = raise(level, "medium");
      reasons.push("few_docks_at_dropoff");
    }
  }

  const leadMinutes = (Date.parse(leg.start.scheduled) - now.getTime()) / 60_000;
  if (leadMinutes > LONG_LEAD_MINUTES && level !== "low") reasons.push("long_lead_time");
  return { level, reasons };
}

/** Which station a backup should replace, and what it needs to have. */
function backupNeed(leg: Leg, risk: DockRisk): { station: DockInfo; need: "bikes" | "docks" } | null {
  if (risk.reasons.some((r) => r === "no_docks_at_dropoff" || r === "few_docks_at_dropoff") && leg.to.bikeStation) {
    return { station: leg.to.bikeStation, need: "docks" };
  }
  if (risk.reasons.some((r) => r === "no_bikes_at_pickup" || r === "few_bikes_at_pickup") && leg.from.bikeStation) {
    return { station: leg.from.bikeStation, need: "bikes" };
  }
  return null;
}

/** Score every rented-bike leg and suggest a nearby backup station for risky ones. */
export async function addDockRisk(
  itineraries: Itinerary[],
  ingest: Pick<IngestClient, "bikesNearby">,
  now: Date,
): Promise<Itinerary[]> {
  return Promise.all(
    itineraries.map(async (it) => ({
      ...it,
      legs: await Promise.all(
        it.legs.map(async (leg) => {
          const risk = assessDockRisk(leg, now);
          if (!risk) return leg;
          const need = risk.level === "low" ? null : backupNeed(leg, risk);
          if (need) {
            try {
              const nearby = await ingest.bikesNearby(need.station.lat, need.station.lon, BACKUP_RADIUS_METERS, 10);
              const backup = nearby.find(
                (s) =>
                  s.id !== need.station.stationId &&
                  s.status === "active" &&
                  ((need.need === "docks" ? s.docks : s.bikes) ?? 0) >= FEW,
              );
              if (backup) {
                risk.backup = {
                  stationId: backup.id,
                  name: backup.name.zh,
                  lat: backup.lat,
                  lon: backup.lon,
                  bikesAvailable: backup.bikes,
                  docksAvailable: backup.docks,
                };
              }
            } catch {
              // No backup suggestion if ingest is unavailable.
            }
          }
          return { ...leg, dockRisk: risk };
        }),
      ),
    })),
  );
}
