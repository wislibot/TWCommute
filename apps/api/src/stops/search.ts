import type { Locale, SearchResult } from "@twc/contracts";
import type { OtpClient } from "../otp/client";
import { SEARCH_QUERY } from "../otp/queries";
import type { OtpSearchData, OtpSearchStop } from "../otp/types";
import { mapMode } from "../plan/map";

export const MAX_RESULTS = 20;

const OTP_LANGUAGE: Record<Locale, string> = { "zh-TW": "zh", en: "en", ja: "ja", ko: "ko" };

/**
 * Search stations and stops by name. Stations (MRT/rail) rank first; bus stops that share a
 * name (one per direction) collapse into one result. Exact and prefix matches rank higher.
 */
export async function searchStops(
  q: string,
  locale: Locale,
  deps: { otp: Pick<OtpClient, "query"> },
): Promise<SearchResult[]> {
  const data = await deps.otp.query<OtpSearchData>(SEARCH_QUERY, { q, lang: OTP_LANGUAGE[locale] }, locale);
  const stations = (data.stations ?? []).filter((s): s is OtpSearchStop => !!s);
  // Platforms/exits of a returned station are redundant.
  const stationIds = new Set(stations.map((s) => s.gtfsId));
  const stops = (data.stops ?? []).filter(
    (s): s is OtpSearchStop => !!s && !(s.parentStation && stationIds.has(s.parentStation.gtfsId)),
  );

  const seen = new Set<string>();
  const results: Array<SearchResult & { score: number }> = [];
  for (const [kind, list] of [
    ["station", stations],
    ["stop", stops],
  ] as const) {
    for (const s of list) {
      const key = `${kind}:${s.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        id: s.gtfsId,
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        kind,
        modes: s.vehicleMode ? [mapMode(s.vehicleMode)] : [],
        score: (kind === "station" ? 0 : 10) + matchRank(s.name, q),
      });
    }
  }
  return results
    .sort((a, b) => a.score - b.score || a.name.length - b.name.length)
    .slice(0, MAX_RESULTS)
    .map(({ score: _score, ...r }) => r);
}

function matchRank(name: string, q: string): number {
  const n = name.toLowerCase();
  const query = q.toLowerCase();
  if (n === query) return 0;
  if (n.startsWith(query)) return 1;
  return 2;
}
