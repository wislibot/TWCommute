import type { City } from "./cities";
import type { TpassMode, TpassPass } from "./tpass";

/** A leg as the fare engine sees it. The API derives these from routed itineraries. */
export interface FareLeg {
  /** null for legs that never cost money (walking, own bike). */
  tpassMode: TpassMode | "thsr" | "other" | null;
  fromCity: City | null;
  toCity: City | null;
}

export type Coverage = "covered" | "partial" | "not_covered" | "unknown";

type LegCoverage = "covered" | "not_covered" | "unknown";

function legCoverage(pass: TpassPass, leg: FareLeg): LegCoverage | null {
  if (leg.tpassMode === null) return null;
  if (leg.tpassMode === "thsr" || leg.tpassMode === "other") return "not_covered";
  if (!pass.modes.includes(leg.tpassMode)) return "not_covered";
  if (leg.fromCity === null || leg.toCity === null) return "unknown";
  return pass.cities.includes(leg.fromCity) && pass.cities.includes(leg.toCity) ? "covered" : "not_covered";
}

/**
 * Whether an itinerary is covered by a TPASS pass. "unknown" is returned when we cannot place
 * a leg in a city; the app shows "may be covered" rather than a wrong answer.
 */
export function evaluateCoverage(pass: TpassPass, legs: FareLeg[]): Coverage {
  const results = legs.map((leg) => legCoverage(pass, leg)).filter((r): r is LegCoverage => r !== null);
  if (results.length === 0) return "covered";
  const covered = results.filter((r) => r === "covered").length;
  const notCovered = results.filter((r) => r === "not_covered").length;
  if (covered === results.length) return "covered";
  if (notCovered === results.length) return "not_covered";
  if (covered > 0 && notCovered > 0) return "partial";
  if (notCovered > 0) return "partial";
  return "unknown";
}
