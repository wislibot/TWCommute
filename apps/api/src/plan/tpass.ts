import type { Itinerary, Leg } from "@twc/contracts";
import { type City, cityFromUid, evaluateCoverage, type FareLeg, findPass } from "@twc/fares";
import { feedId, localId } from "../lib/ids";

/**
 * Metro systems lie inside one living circle, so a representative city is enough to decide
 * TPASS coverage. The Airport MRT is omitted on purpose: only some of its stations are covered
 * by some passes, so it stays "unknown".
 */
const METRO_CITY: Record<string, City> = {
  trtc: "Taipei",
  ntmc: "NewTaipei",
  ntdlrt: "NewTaipei",
  ntalrt: "NewTaipei",
  krtc: "Kaohsiung",
  klrt: "Kaohsiung",
  tmrt: "Taichung",
};

function metroCity(leg: Leg): City | null {
  const keys = [feedId(leg.route?.id), feedId(leg.from.stopId), leg.route?.agencyName]
    .filter((k): k is string => !!k)
    .map((k) => k.toLowerCase());
  for (const key of keys) {
    const hit = METRO_CITY[key] ?? (/臺北捷運|台北捷運|taipei metro/.test(key) ? "Taipei" : undefined);
    if (hit) return hit;
  }
  return null;
}

/**
 * The TDX national feed names HSR 臺灣高速鐵路股份有限公司 (no "高鐵") and uses station pairs
 * (左營-南港) as long names, so its route ids (`tw:THSR_0108_1`) are the reliable marker there.
 */
function isThsr(leg: Leg): boolean {
  if (localId(leg.route?.id)?.startsWith("THSR_")) return true;
  const text =
    `${feedId(leg.route?.id) ?? ""} ${leg.route?.agencyName ?? ""} ${leg.route?.longName ?? ""}`.toLowerCase();
  return /thsr|高鐵|高速鐵路|high speed/.test(text);
}

/** Describe a leg for the TPASS evaluator; unknown cities stay null (→ "may be covered"). */
export function toFareLeg(leg: Leg): FareLeg {
  switch (leg.mode) {
    case "WALK":
      return { tpassMode: null, fromCity: null, toCity: null };
    case "BICYCLE": {
      if (!leg.rentedBike) return { tpassMode: null, fromCity: null, toCity: null };
      return {
        tpassMode: "bike_share",
        fromCity: cityFromUid(localId(leg.from.bikeStation?.stationId)),
        toCity: cityFromUid(localId(leg.to.bikeStation?.stationId)),
      };
    }
    case "BUS": {
      const fromCity = cityFromUid(leg.from.stopId);
      const toCity = cityFromUid(leg.to.stopId);
      return { tpassMode: fromCity || toCity ? "city_bus" : "intercity_bus", fromCity, toCity };
    }
    case "COACH":
      return { tpassMode: "intercity_bus", fromCity: cityFromUid(leg.from.stopId), toCity: cityFromUid(leg.to.stopId) };
    case "SUBWAY":
    case "GONDOLA": {
      const city = metroCity(leg);
      return { tpassMode: "metro", fromCity: city, toCity: city };
    }
    case "TRAM": {
      const city = metroCity(leg);
      return { tpassMode: "light_rail", fromCity: city, toCity: city };
    }
    case "RAIL":
      return isThsr(leg)
        ? { tpassMode: "thsr", fromCity: null, toCity: null }
        : { tpassMode: "tra_local", fromCity: null, toCity: null };
    case "FERRY":
      return { tpassMode: "ferry", fromCity: null, toCity: null };
    default:
      return { tpassMode: "other", fromCity: null, toCity: null };
  }
}

export function addTpassCoverage(itineraries: Itinerary[], passId: string | undefined): Itinerary[] {
  const pass = passId ? findPass(passId) : undefined;
  if (!pass) return itineraries;
  return itineraries.map((it) => ({
    ...it,
    tpass: { passId: pass.id, coverage: evaluateCoverage(pass, it.legs.map(toFareLeg)) },
  }));
}
