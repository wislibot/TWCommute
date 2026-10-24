import type { Itinerary, Leg, LegPlace } from "@twc/contracts";
import { type City, cityFromUid, evaluateCoverage, type FareLeg, findPass } from "@twc/fares";
import { feedId, localId } from "../lib/ids";
import { cityAt } from "./city";

/** A place's city: from its TDX id when it carries a city code, else from where it is. */
function cityOf(place: LegPlace, id?: string): City | null {
  return cityFromUid(localId(id ?? place.stopId)) ?? cityAt(place.lat, place.lon);
}

/**
 * TRA train classes, the `<type>` in TDX route ids `TRA_<trainNo>_<direction>_<type>`. TPASS takes
 * every class except Taroko, Puyuma, EMU3000, tour and group trains (all 桃竹竹苗 and 基北北桃 rules).
 * Matched against TRA's open timetable of 2026-10-24 (train numbers and notes): 1101 Taroko, 1107
 * Puyuma, 110G/110H/110K/110M EMU3000 (every 自強(3000) train number, and nothing else); 1108/1109
 * push-pull 自強, 110A/110F other 自強, 1110 莒光, 1131 區間, 1132 區間快. Other classes stay unknown.
 */
const TRA_EXCLUDED = new Set(["1101", "1107", "110G", "110H", "110K", "110M"]);
const TRA_ACCEPTED = new Set(["1108", "1109", "110A", "110F", "1110", "1131", "1132"]);

function traClass(leg: Leg): "accepted" | "excluded" | "unknown" {
  const type = /^TRA_[0-9A-Za-z]+_\d+_([0-9A-Za-z]+)$/.exec(localId(leg.route?.id) ?? "")?.[1];
  if (!type) return "unknown";
  return TRA_EXCLUDED.has(type) ? "excluded" : TRA_ACCEPTED.has(type) ? "accepted" : "unknown";
}

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
        fromCity: cityOf(leg.from, leg.from.bikeStation?.stationId),
        toCity: cityOf(leg.to, leg.to.bikeStation?.stationId),
        minutes: leg.durationSeconds / 60,
      };
    }
    case "BUS": {
      // City buses carry their city in the stop id (HSZ…); intercity stops (THB…) do not.
      const cityBus = cityFromUid(leg.from.stopId) !== null || cityFromUid(leg.to.stopId) !== null;
      return { tpassMode: cityBus ? "city_bus" : "intercity_bus", fromCity: cityOf(leg.from), toCity: cityOf(leg.to) };
    }
    case "COACH":
      return { tpassMode: "intercity_bus", fromCity: cityOf(leg.from), toCity: cityOf(leg.to) };
    case "SUBWAY":
    case "GONDOLA": {
      const city = metroCity(leg);
      return { tpassMode: "metro", fromCity: city, toCity: city };
    }
    case "TRAM": {
      const city = metroCity(leg);
      return { tpassMode: "light_rail", fromCity: city, toCity: city };
    }
    case "RAIL": {
      if (isThsr(leg)) return { tpassMode: "thsr", fromCity: null, toCity: null };
      const cls = traClass(leg);
      if (cls === "excluded") return { tpassMode: "other", fromCity: null, toCity: null };
      return {
        tpassMode: "tra_local",
        fromCity: cityAt(leg.from.lat, leg.from.lon),
        toCity: cityAt(leg.to.lat, leg.to.lon),
        ...(cls === "unknown" ? { uncertain: true } : {}),
      };
    }
    case "FERRY":
      return { tpassMode: "ferry", fromCity: cityOf(leg.from), toCity: cityOf(leg.to) };
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
